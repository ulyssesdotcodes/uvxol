import { Module, VuexModule, Action, Mutation, MutationAction, getModule } from 'vuex-module-decorators';
import { ActionEvent, EventId, VoteOption, VoteOptionId, ActionId } from '@/types';
import * as ty from '@/types';
import store from '@/store';
import eventStore from './events';
import Socket from './socket';
import e from 'express';


const socket = new Socket();

@Module({ dynamic: true, name: 'runStore', store })
class Run extends VuexModule {
  public runHandle: number | undefined;
  public lastTime: number = 0;

  public speed: number = 1;
  public syncTime: number = 0;
  public startTime: number = 0;
  public timeScale: number = 1;
  public time: number = 0;

  public funMeter: number = 0;

  private started = false;

  static startEvents: (id?: number) => ActionEvent[] = id =>
    id
      ? [eventStore.events[id]]
      : eventStore.eventsList.filter(e => eventStore.eventsByTrigger[e.id] == null)

  public chosenVoteOptions: number[] = [];
  public events: ty.EventRenderData[] = [];
  public eventsById: {[id: number]: ty.EventRenderData} = {};
  public actionList: ty.ActionRenderData<ty.ActionType>[] = [];

  @Action({ commit: 'restart', rawError: true })
  public async start(id?: number) {
    socket.onConnected(() => {
      socket.send(JSON.stringify({ type: 'fetchState' }))
    });
    return id;
  }

  @Action({ commit: 'addVote', rawError: true })
  public async chooseVote(va: [string, VoteOptionId, ActionId]) {
    socket.send(JSON.stringify({ type: "vote", voteOptionId: va[1], actionId: va[2], vote: va[0] }))
  }

  @Action({ commit: 'setVoteOptions', rawError: true })
  public async overrideVoteOptions(vos: VoteOptionId[]) {
    socket.send(JSON.stringify({ type: "overrideVoteOptions", voteOptionIds: vos }))
  }

  @Action({ commit: 'changeTimeScale' })
  public async setTimeScale(timeScale: number) {
    return timeScale;
  }

  @Action({ commit: 'multTimeScale' })
  public async doubleSpeed() {
    return 2;
  }

  @Action({ commit: 'multTimeScale' })
  public async halfSpeed() {
    return 0.5;
  }


  @Mutation
  public async restart(id?: number) {
    if (!this.started) {
      socket.addListener(msg => {
        switch (msg.type) {
          case "replaceState":
            this.actionList = msg.actions.filter(a => !ty.isServerMeterAction(a));
            this.funMeter = 0;
            (msg.actions.filter(a => ty.isServerMeterAction(a)) as ty.ServerType<ty.EditableAction<"meter">>[])
              .forEach(a => this.funMeter += a.meterType === "fun" ? a.value : 0);
            this.events = msg.events;
            this.events.forEach(e => this.eventsById[e.id] = e);
            this.syncTime = performance.now();
            this.startTime = msg.time;
            this.time = this.startTime;
            this.speed = msg.speed;
            break;
          case "speedChange":
            this.syncTime = performance.now();
            this.startTime = msg.time;
            this.time = this.startTime;
            this.speed = msg.speed;
            break;
          case "addAction":
            if(ty.isServerMeterAction(msg.data) && msg.data.meterType === "fun") {
              this.funMeter += msg.data.value;
            } else {
              this.actionList.push(msg.data);
            }
            break;
          case "addEvent":
            const curEvent = this.eventsById[msg.data.id];
            if(curEvent) {
              Object.assign(curEvent, msg.data);
            } else {
              this.eventsById[msg.data.id] = msg.data;
            }

            if(this.eventsById[msg.data.id].state === "finished") {
              this.events = this.events.filter(e => e.id !== msg.data.id);
            } else if(!this.events.find(e => e.id === msg.data.id)){
              this.events.push(this.eventsById[msg.data.id]);
            }

            break;
          case "removeEvent":
            this.events = this.events.filter(e => e.id !== msg.id);
            delete this.eventsById[msg.id];
            break;
          case "removeAction":
            this.actionList = this.actionList.filter(a => a.id !== msg.id);
            break;
        }
      });

      this.started = true;

      const updateTime = () => {
        this.time = this.startTime + (performance.now() - this.syncTime) * this.speed;
        setTimeout(updateTime, 1000);
      }

      updateTime();
    }

    socket.send(JSON.stringify({ type: 'restart' }))
    socket.send(JSON.stringify({ type: 'setPlaySpeed', speed: 1 }))
  }

  @Mutation
  public async setVoteOptions(vos: VoteOptionId[]) {
    this.chosenVoteOptions = vos;
  }

  @Mutation
  public async changeTimeScale(timeScale: number) {
    socket.send(JSON.stringify({ type: 'setPlaySpeed', speed: timeScale }))
  }

  @Mutation
  public async multTimeScale(timeScaleMult: number) {
    socket.send(JSON.stringify({ type: 'setPlaySpeed', speed: this.speed * timeScaleMult }))
  }
}

export default getModule(Run);
