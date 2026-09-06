/* Ponte da janela principal com o processo principal.
 *
 * Superfície mínima de propósito: perguntar se o som do sistema é possível,
 * ligar e desligar. Nada de arquivo, processo ou resto do Electron. A página
 * em public/ funciona sem isto — quando roda no navegador, `window.transmissor`
 * simplesmente não existe e o botão não aparece. */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('transmissor', {
  somDoSistema: {
    disponivel: () => ipcRenderer.invoke('som:disponivel'),
    aplicativos: () => ipcRenderer.invoke('som:aplicativos'),
    automatico: () => ipcRenderer.invoke('som:automatico'),
    ligar: alvo => ipcRenderer.invoke('som:ligar', alvo),
    desligar: () => ipcRenderer.invoke('som:desligar'),
  },
});
