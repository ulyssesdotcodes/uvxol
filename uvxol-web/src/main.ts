import Vue from 'vue';
import App from './App.vue';
import router from './router';
import vuetify from './plugins/vuetify';
import store from './store';

Vue.config.productionTip = false;
Vue.config.silent = true;
Vue.config.performance = true

new Vue({
  vuetify,
  router,
  store,
  render: (h) => h(App),
}).$mount('#app');
