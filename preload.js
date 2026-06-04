'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  auth: {
    isSetup:        ()            => ipcRenderer.invoke('auth:isSetup'),
    setup:          (pwd)         => ipcRenderer.invoke('auth:setup', pwd),
    login:          (pwd)         => ipcRenderer.invoke('auth:login', pwd),
    logout:         ()            => ipcRenderer.invoke('auth:logout'),
    changePassword: (oldPwd, newPwd) => ipcRenderer.invoke('auth:changePassword', { oldPwd, newPwd }),
  },
  accounts: {
    getAll:         ()           => ipcRenderer.invoke('accounts:getAll'),
    add:            (d)          => ipcRenderer.invoke('accounts:add', d),
    update:         (id, u)      => ipcRenderer.invoke('accounts:update', { id, u }),
    delete:         (id)         => ipcRenderer.invoke('accounts:delete', id),
    getCredentials: (id)         => ipcRenderer.invoke('accounts:getCredentials', id),
    reorder:        (ids)        => ipcRenderer.invoke('accounts:reorder', ids),
  },
  riot: {
    fetchRanking:    (id)               => ipcRenderer.invoke('riot:fetchRanking', id),
    fetchAllRankings: ()                => ipcRenderer.invoke('riot:fetchAllRankings'),
    fetchChampions:  (id)               => ipcRenderer.invoke('riot:fetchChampions', id),
    lookupPuuid:     (nickname, tag, server) => ipcRenderer.invoke('riot:lookupPuuid', { nickname, tag, server }),
    getLiveGame:     (id)               => ipcRenderer.invoke('riot:getLiveGame', id),
    getDDVersion:    ()                 => ipcRenderer.invoke('ddragon:getVersion'),
  },
  apiKey: {
    getStatus:      ()    => ipcRenderer.invoke('apiKey:getStatus'),
    save:           (key) => ipcRenderer.invoke('apiKey:save', key),
    validate:       (key) => ipcRenderer.invoke('apiKey:validate', key),
    testStored:     ()    => ipcRenderer.invoke('apiKey:testStored'),
    openRenewalPage: ()   => ipcRenderer.invoke('apiKey:openRenewalPage'),
  },
  settings: {
    get:  ()            => ipcRenderer.invoke('settings:get'),
    set:  (key, value)  => ipcRenderer.invoke('settings:set', { key, value }),
  },
  clipboard: {
    copyLogin:    (id) => ipcRenderer.invoke('clipboard:copy', { id, field: 'login' }),
    copyPassword: (id) => ipcRenderer.invoke('clipboard:copy', { id, field: 'password' }),
  },
  tools: {
    killRiotProcesses: () => ipcRenderer.invoke('tools:killRiotProcesses'),
    clearClientCache:  () => ipcRenderer.invoke('tools:clearClientCache'),
    repairClient:      () => ipcRenderer.invoke('tools:repairClient'),
    openDataFolder:    () => ipcRenderer.invoke('tools:openDataFolder'),
  },
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close:    () => ipcRenderer.invoke('window:close'),
    hide:     () => ipcRenderer.invoke('window:hide'),
    show:     () => ipcRenderer.invoke('window:show'),
  },
  app: {
    openMain:       () => ipcRenderer.invoke('app:openMain'),
    getVersion:     () => ipcRenderer.invoke('app:getVersion'),
    getLastRefresh: () => ipcRenderer.invoke('app:getLastRefresh'),
  },
  backup: {
    export: (password) => ipcRenderer.invoke('backup:export', { password }),
    import: (password) => ipcRenderer.invoke('backup:import', { password }),
  },
  update: {
    check:   ()  => ipcRenderer.invoke('update:check'),
    install: ()  => ipcRenderer.invoke('update:install'),
  },
  startup: {
    get: ()             => ipcRenderer.invoke('startup:get'),
    set: (openAtLogin)  => ipcRenderer.invoke('startup:set', { openAtLogin }),
  },
  on:  (ch, fn) => {
    const valid = ['rankUpdate','apiKeyStatus','notification','closeRequest','navigate','update:status','update:progress','lastRefresh'];
    if (valid.includes(ch)) ipcRenderer.on(ch, (_, ...args) => fn(...args));
  },
  off: (ch, fn) => ipcRenderer.off(ch, fn),
});
