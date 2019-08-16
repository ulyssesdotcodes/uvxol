export type ActionId = number;

export interface Action {
    id: ActionId;
    type: number;
    name: string;
    location: string;
    file?: string;
    voteOptions?: VoteOption[];
}

export const ActionTypesMap: { [type: string]: number } = { audio: 0, video: 1, vote: 2};

export type EventId = number;

export interface ActionEvent {
    id: EventId;
    name: string,
    duration: number;
    delay?: number | null;
    dependencies: VoteOption[];
    preventions: VoteOption[];
    actions: Action[];
    triggers: EventId[];
}

export type VoteOptionId = number;

export interface VoteOption {
    id: VoteOptionId;
    name: string;
    text?: string | null;
    preventions: VoteOptionId[];
    dependencies: VoteOptionId[];
}

