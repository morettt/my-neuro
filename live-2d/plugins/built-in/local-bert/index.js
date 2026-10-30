const { Plugin } = require('../../../js/core/plugin-base');

// 本地服务由控制面板根据 metadata.localService 管理，桌宠无需重复启动进程。
module.exports = class LocalBertPlugin extends Plugin {};
