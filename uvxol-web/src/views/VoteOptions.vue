<template>
  <v-container>
    <v-row>
      <v-col>
        <VoteOptionsList
          v-bind:voteOptions="voteOptions"
          v-bind:err="err"
          v-on:data-change="refresh"
        ></VoteOptionsList>
      </v-col>
    </v-row>
  </v-container>
</template>

<script lang="ts">
import { Vue, Component, Watch } from "vue-property-decorator";
import CreateVoteOption from "../components/CreateVoteOption.vue";
import VoteOptionsList from "../components/VoteOptionsList.vue";
import { VoteOption } from "../types";
import voteOptionStore from "../store/modules/voteoptions";

// Super important to add your components here!
@Component({
  components: { CreateVoteOption, VoteOptionsList },
})
export default class VoteOptions extends Vue {
  private err = "loading";

  get voteOptions() {
    return voteOptionStore.voteOptionsList;
  }
  refresh() {
    this.err = "loading";
    voteOptionStore
      .getVoteOptions()
      .then(() => (this.err = "loaded"))
      .catch((e: any) => (this.err = e));
  }
  protected mounted() {
    this.refresh();
  }
}
</script>
