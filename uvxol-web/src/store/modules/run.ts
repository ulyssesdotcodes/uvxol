import Vue from 'vue';
import { Module, VuexModule, Action, Mutation, MutationAction, getModule } from 'vuex-module-decorators';
import { ActionEvent, EventId, VoteOption, VoteOptionId, ActionId } from '@/types';
import * as ty from '@/types';
import store from '@/store';
import eventStore from './events';
import voteOptionStore from './voteoptions';
import { task, array, set, eq, option, semigroup, ord, nonEmptyArray, tuple } from 'fp-ts';
import { flow, constVoid, constant, identity, flip } from 'fp-ts/lib/function';
import { pipe } from 'fp-ts/lib/pipeable';
import { logid, logval } from '../../utils/fp-utils';
import * as idt from 'fp-ts/lib/Identity';
import * as cnst from 'fp-ts/lib/Const';
import * as trv from 'fp-ts/lib/Traversable';
import * as fld from 'fp-ts/lib/Foldable';
import * as ap from 'fp-ts/lib/Applicative';
import * as tup from 'fp-ts/lib/Tuple';
import * as m from 'fp-ts/lib/Monoid';
import * as mo from 'fp-ts/lib/Monad';
import * as rand from 'fp-ts/lib/Random';
import * as f from 'fp-ts/lib/Functor';
import * as ot from 'fp-ts/lib/OptionT';
import * as chn from 'fp-ts/lib/Chain';
import { getFilterableComposition } from 'fp-ts/lib/Filterable';
import Socket from './socket';
import { eqNumber } from 'fp-ts/lib/Eq';
import { foldLeft } from 'fp-ts/lib/ReadonlyArray';
import { Task, taskSeq } from 'fp-ts/lib/Task';
import { IORef } from 'fp-ts/lib/IORef';
import { io } from 'fp-ts/lib/IO';

const eqActionEvent = eq.eq.contramap(eq.eqNumber, (e: ActionEvent) => e.id);
const eqViewEvent = eq.eq.contramap(eq.eqNumber, (e: ty.ViewEvent) => e.id);
const tseq_: <A>(ta: task.Task<A>[]) => task.Task<void> =
  ta => fld.traverse_(task.taskSeq, array.array)(ta, task.map(constVoid))
const tseq: <A>(ta: task.Task<A>[]) => task.Task<A[]> =
  array.traverse(task.taskSeq)(a => a);
const tparallel: <A>(ta: task.Task<A>[]) => task.Task<A[]> =
  array.traverse(task.task)(a => a);
const tparallel_: <A>(ta: task.Task<A>[]) => task.Task<void> =
  ta => fld.traverse_(task.task, array.array)(ta, task.map(constVoid))

const delayCoroutine: (time: number) => <A>(t: Task<A>) => Task<A> = time => flow(
  task.chain(a => () => new Promise((res, rej) => {
    res(a);
  }))
)

const checkVoteOptions:
  (chosenVoteOptions: number[]) =>
    (target: boolean) =>
      (checkVoteOptions: VoteOption[]) => boolean[] = chosenVoteOptions => target =>
        array.map((voteOption: VoteOption) => (chosenVoteOptions.includes(voteOption.id)) === target)

const checkEventShouldRun = (chosenVoteOptions: number[], e: ty.ActionEvent) => pipe(
  array.getMonoid<boolean>().concat(
    // Check if chosenVoteOptions contains dependencies
    checkVoteOptions(chosenVoteOptions)(true)(e.dependencies),
    // Check if chosenVoteOptions doesn't contain preventions
    checkVoteOptions(chosenVoteOptions)(false)(e.preventions)
  ),
  ds => semigroup.fold(semigroup.semigroupAll)(true, ds),
  // Convert `false` to None
  option.fromPredicate(identity),
)

declare module 'fp-ts/lib/HKT' {
  interface URItoKind<A> {
    TaskOption: task.Task<option.Option<A>>
  }
}
const taskOption: mo.Monad1<'TaskOption'> = {
  URI: 'TaskOption',
  ...ot.getOptionM(task.task)
}

const actionEventToViewEvent: (e: ty.ActionEvent) => ty.ViewEvent = e =>
  Object.assign({}, e, {
    active: false,
    actions: e.actions.map(a =>
      // Disable UI elements on start
      Object.assign({ active: false }, a))
  });

// Create a task to be run before event
const eventPrepareTask: (self: Run, resetCount: number, e: ty.ActionEvent) => task.Task<ty.ViewEvent> =
  (self, resetCount, e) => pipe(
    // Push the event into the run list
    task.fromIO(() => actionEventToViewEvent(e)),
    task.chainFirst(e => task.fromIO(() => {
      if (self.resetCount === resetCount) {
        self.runList.push(e)
      }
    }))
  );

// Create a task to be run after delay, but before duration
// The task's output is a new ViewEvent with everything active
const eventStartTask: (self: Run, resetCount: number) => (e: ty.ViewEvent) => task.Task<ty.ViewEvent> =
  (self, resetCount) => e => pipe(
    // Run the actions
    e.actions,
    array.map(actionStartTask(self, resetCount, e)),
    tparallel,
    // Immutably set the view event and its actions to active
    task.map((actions: ty.ViewAction<ty.ActionType>[]) => Object.assign(
      {},
      e,
      { active: true, actions }
    )),
  );

// Create a task to be run after delay, but before duration
// The task's output is the active event
const actionStartTask: (self: Run, resetCount: number, e: ty.ViewEvent) => (a: ty.ViewAction<ty.ActionType>) => task.Task<ty.ViewAction<ty.ActionType>> =
  (self, resetCount, e) => a => pipe(
    Object.assign({}, a, { active: true }),
    task.of,
    task.chainFirst(sendToTD(self, resetCount, e))
  );

// Create a task to be run after delay, and after duration
const eventEndTask: (self: Run, resetCount: number) => (e: ty.ViewEvent) => task.Task<ty.ViewEvent> =
  (self, resetCount) => e => pipe(
    e.actions,
    // Run all the actions
    array.map(actionEndTask(self, resetCount, e)),
    tparallel,
    // Immutably set the view event and its actions to active
    task.map((actions: ty.ViewAction<ty.ActionType>[]) => Object.assign(
      {},
      e,
      { active: false, actions }
    )),
    // Create tasks for all the triggered events
    task.chainFirst(inactiveEvent => pipe(
      // Delay to give the events time to load
      task.of(inactiveEvent.triggers),
      task.map(array.map(triggeredEventId => eventStore.events[triggeredEventId])),
      task.map(set.fromArray(eqActionEvent)),
      task.chainFirst(s => pipe(
        s,
        Run.runEvents(self, resetCount),
        tparallel_,
      )),
    ))
  )

// Create a task to be run after delay and duration
const actionEndTask: (self: Run, resetCount: number, e: ty.ViewEvent) => (a: ty.ViewAction<ty.ActionType>) => task.Task<ty.ViewAction<ty.ActionType>> =
  (self, resetCount, e) => a => pipe(
    Object.assign({}, a, { active: false }),
    task.of,
    task.chainFirst(sendToTD(self, resetCount, e)),
    task.chainFirst(a => ty.isVoteAction(a) ?
      actionEndVote(self, resetCount)(a) : task.fromIO(() => undefined))
  );

const actionEndVote: (self: Run, resetCount: number) => (a: ty.ViewAction<"vote">) => task.Task<void> =
  (self, resetCount) => a =>
    pipe(
      // Create a Task<Option<_>> from the pending vote options
      () => Promise.resolve(option.fromNullable(self.pendingVoteOptions[a.id])),
      // Figure out the voteoptionid that won 
      ta => taskOption.chain(ta, flow(
        // Sort the voteoptions
        array.sort(ord.ordNumber),
        // chop into same vote options
        array.chop(as => {
          const { init, rest } = array.spanLeft((a: number) => eq.eqNumber.equals(a, as[0]))(as)
          return [init, rest];
        }),
        // convert array of votes to [vote, count] tuple
        array.map(arr => [arr[0], arr.length] as [number, number]),
        // convert to nonemptyarray
        nonEmptyArray.fromArray,
        // grab the max based on the second tuple element
        option.map(nonEmptyArray.max(ord.ord.contramap(ord.ordNumber, e => e[1]))),
        // grab the voteoption id of the tuple
        option.map(tuple.fst),
        // Create task
        task.of
      )),
      task.chain(option.fold(
        () => pipe(
          a.voteOptions,
          vo => pipe(
            task.fromIO(rand.randomInt(0, vo.length - 1)),
            task.map(n => vo[n].id),
          )
        ),
        n => task.of(n)
      )),
      // Set chosenVoteOptions[winningVoteOptionId] to winningVoteOptionId
      chosen => task.ap(chosen)(task.of((r: number) => {
        if (self.resetCount === resetCount) {
          self.chosenVoteOptions.push(r);
          self.world.chosenVoteOptions.add(r);
        }
      })),
    )

const socket = new Socket();

// Send an action to TD
const sendToTD: (self: Run, resetCount: number, actionEvent: ty.ViewEvent) => (action: ty.ViewAction<ty.ActionType>) => task.Task<void> =
  (self, resetCount, actionEvent) => action => task.fromIO(() => {
    if (self.resetCount === resetCount) {
      socket.send(JSON.stringify({
        eventId: actionEvent.id,
        actionId: action.id,
        action: action.type,
        zone: action.zone,
        location: action.location,
        active: action.active,
        filePath: ty.isNotVoteAction(action) ? action.filePath : undefined,
        voteOptions: ty.isVoteAction(action) ? action.voteOptions : undefined,
      }))
    }
  });

///////////////////////
// New w/ triggers / ecs
///////////////////////

// Send an action to TD
const sendToTDECS: (actionEventId: number, active: boolean) => (action: ty.ViewAction<ty.ActionType>) => void =
  (actionEventId, active) => action =>
    socket.send(JSON.stringify({
      eventId: actionEventId,
      actionId: action.id,
      action: action.type,
      zone: action.zone,
      location: action.location,
      active: active,
      filePath: ty.isNotVoteAction(action) ? action.filePath : undefined,
      voteOptions: ty.isVoteAction(action) ? action.voteOptions : undefined,
    }))

export const timeActiveSystem = (time: number, ts: IterableIterator<ty.TimeTriggerComponent>) => {
  for (let t of ts) {
    t.timeActive = time > t.timeOn;
  }
}

export const timeToggleSystem = (time: number, ts: IterableIterator<ty.TimeToggleComponent>) => {
  for (let t of ts) {
    t.timeActive = time > t.timeOn && time < t.timeOff;
  }
}

export const dependenciesActiveSystem = (chosenVoteOptions: Set<number>, ts: IterableIterator<ty.DependenciesTriggerComponent>) => {
  for (let t of ts) {
    t.dependenciesActive = t.dependencies.every(d => chosenVoteOptions.has(d));
  }
}

export const eventTriggerSystem = (world: ty.World, ets: IterableIterator<ty.EventTrigger>) => {
  for (let et of ets) {
    if (
      et.dependenciesActive && et.timeActive &&
      !world.triggeredEvents.has(et.eventId)
      // && world.events.has(et.eventId)
    ) {
      const viewEvent = actionEventToViewEvent(eventStore.events[et.eventId]); //world.events.get(et.eventId)!;
      console.log("Adding trigger " + viewEvent.name);
      // Add a TriggeredEvent which might not be active yet
      world.triggeredEvents.set(et.eventId, {
        eventId: et.eventId,
        timeTriggered: undefined,
        timeActive: false,
        timeOn: world.time + viewEvent.delay,
        timeOff: world.time + viewEvent.delay + viewEvent.duration
      })
    }
  }
}

export const activateTriggeredEventSystem = (world: ty.World, ets: IterableIterator<ty.TriggeredEvent>) => {
  for (let te of ets) {
    // const viewEvent = world.events.get(te.eventId);
    const viewEvent = actionEventToViewEvent(eventStore.events[te.eventId]); //world.events.get(et.eventId)!;
    if (te.timeActive && te.timeTriggered === undefined && viewEvent !== undefined) {
      console.log("Playing " + viewEvent.name);
      te.timeTriggered = world.time;
      // send to TD
      viewEvent.actions.forEach(a => sendToTDECS(te.eventId, true));
    } else if (!te.timeActive && te.timeTriggered !== undefined && viewEvent !== undefined) {
      console.log("Stopping " + viewEvent.name);
      // add eventtriggers for the triggers
      viewEvent.triggers.forEach(t => {
        const triggeredEvent = actionEventToViewEvent(eventStore.events[t]);//world.events.get(t);
        console.log("Adding trigger " + triggeredEvent.name);
        if (triggeredEvent) {
          world.triggers.add({
            eventId: t,
            timeActive: false,
            timeOn: 0,
            dependenciesActive: false,
            dependencies: triggeredEvent.dependencies.map(n => n.id)
          });
        }
      });
      te.timeTriggered = undefined;
      // send to TD
      viewEvent.actions.forEach(a => sendToTDECS(te.eventId, false));
    }
  }
}

const defaultWorld: ty.World = {
  events: new Map(),
  triggeredEvents: new Map(),
  triggers: new Set(),
  chosenVoteOptions: new Set(),
  time: 0,
}

const run = (prevTime: number, world: ty.World) => {
  const currentTime = performance.now();
  world.time += currentTime - prevTime;
  timeActiveSystem(world.time, world.triggers.values());
  dependenciesActiveSystem(world.chosenVoteOptions, world.triggers.values());
  eventTriggerSystem(world, world.triggers.values());

  timeToggleSystem(world.time, world.triggeredEvents.values());
  activateTriggeredEventSystem(world, world.triggeredEvents.values());

  requestAnimationFrame(() => run(currentTime, world));
}


////////////////////////
/// End ECS
/////////////////////

@Module({ dynamic: true, name: 'runStore', store })
class Run extends VuexModule {

  static startEvents: (id?: number) => ActionEvent[] = id =>
    id
      ? [eventStore.events[id]]
      : eventStore.eventsList.filter(e => eventStore.eventsByTrigger[e.id] == null)

  // Generate all tasks required to run these events.
  static runEvents: (self: Run, resetCount: number) => (es: Set<ty.ActionEvent>) => task.Task<void>[] = (self, resetCount) =>
    a => pipe(
      a,
      // Convert set to array ordering by duration
      set.toArray(ord.ord.contramap(ord.ordNumber, e => e.duration)),
      //  Run al lthe valid events
      array.filterMap(Run.runEvent(self, resetCount)),
      array.map(t => task.fromIO(() => {
        // Run the created task when it's made.
        // This feels super hacky.
        t();
      }))
    )

  // Generate a task to run this event. This task includes data fetching, triggering other events, etc.
  static runEvent: (self: Run, resetCount: number) => (e: ty.ActionEvent) => option.Option<task.Task<void>> = (self, resetCount) => e =>
    pipe(
      e,
      option.fromNullable,
      // If the event shouldn't be run, return None
      option.chainFirst(e => checkEventShouldRun(self.chosenVoteOptions, e)),
      option.map(e => tparallel_([
        // Fetch events for the trigger id
        () => eventStore.getEventsForTrigger(e.id).then(constVoid),
        // Run the events
        pipe(
          eventPrepareTask(self, resetCount, e),
          // Run start task in parallel to prep task
          task.chainFirst(flow(
            eventStartTask(self, resetCount),
            task.chainIOK(
              ve => () => {
                if (self.resetCount === resetCount) {
                  self.runList.splice(self.runList.findIndex(re => ve.id === re.id), 1, ve)
                }
              }
            ),
            task.delay(e.delay || 0)
          )),
          // Run end task after start task
          task.chain(flow(
            eventEndTask(self, resetCount),
            task.chainIOK(ve => () => {
              if (self.resetCount === resetCount) {
                self.runList.splice(self.runList.findIndex(re => ve.id === re.id), 1, ve)
              }
            }),
            task.delay(e.duration || 0)
          )),
        )
      ])),
    )


  // List of events that have run. Used for Debugging purposes.
  public runList: ty.ViewEvent[] = [];
  public chosenVoteOptions: number[] = [];
  public pendingVoteOptions: { [id: number]: Array<number> } = {};
  // Super hacky way to make sure old runs aren't used
  resetCount = 0;

  get log() {
    return this.runList;
  }

  @Action({ commit: 'restart', rawError: true })
  public async start(id?: number) {
    return id;
  }

  @Action({ commit: 'addVote', rawError: true })
  public async chooseVote(va: [VoteOptionId, ActionId]) {
    return va;
  }

  @Action({ commit: 'setVoteOptions', rawError: true })
  public async overrideVoteOptions(vos: VoteOptionId[]) {
    return vos;
  }

  public world: ty.World = Object.assign({}, defaultWorld);
  private ecsRunning: boolean = false;
  private eventsMap: Map<number, ty.ViewEvent> = new Map();
  @Mutation
  public async restart(id?: number) {
    Object.assign(this.world, defaultWorld);

    return pipe(
      // Reset instance variables
      task.fromIO(() => {
        this.runList = [];
        this.chosenVoteOptions = [];
        this.pendingVoteOptions = {};
        socket.send(JSON.stringify({
          action: "restart"
        }))
        this.resetCount += 1;
      }),
      // fetch the start events
      task.chain(_ => constant(
        id === undefined
          ? eventStore.getStartEvents()
          : eventStore.getEvent(id).then(e => [e])
      )),
      task.map(_ => Run.startEvents(id)),
      task.chainFirst(es => task.fromIO(() => {
        this.world.triggers.clear();
        es.forEach(e => {
          this.world.triggers.add({
            eventId: e.id,
            timeActive: false,
            timeOn: 0,
            dependenciesActive: false,
            dependencies: e.dependencies.map(n => n.id)
          })
        });
        if (!this.ecsRunning) {
          run(performance.now(), this.world);
        }

      })),
      task.map(set.fromArray(eqActionEvent)),
      // Run the start events in sequence
      task.chain(e => tparallel_(Run.runEvents(this, this.resetCount)(e)))
    )();
  }

  @Mutation
  public async addVote([v, a]: [VoteOptionId, ActionId]) {
    Vue.set(this.pendingVoteOptions, a, array.cons(v, this.pendingVoteOptions[a] || []));
  }

  @Mutation
  public async setVoteOptions(vos: VoteOptionId[]) {
    this.chosenVoteOptions = vos;
    this.world.chosenVoteOptions = new Set(vos);
  }

  // @Mutation
  // public async reset() {
  //   this.runList = [];
  //   this.chosenVoteOptions = {};
  //   this.pendingVoteOptions = {};
  //   this.socket.send(JSON.stringify({
  //     action: "restart"
  //   }))
  //   this.resetCount += 1;
  // }
}

export default getModule(Run);
