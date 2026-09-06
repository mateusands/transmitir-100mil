/* Ponte do seletor com o processo principal.
 *
 * Só o seletor usa isto — a janela que carrega a sala não tem preload nenhum.
 * A superfície é de propósito estreita: listar fontes, escolher uma, cancelar.
 * Nada de acesso a arquivo, a processo ou ao resto do Electron. */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('seletor', {
  fontes: () => ipcRenderer.invoke('seletor:fontes'),
  escolher: escolha => ipcRenderer.send('seletor:escolher', escolha),
  cancelar: () => ipcRenderer.send('seletor:cancelar'),
});
