/* Ponte da janela principal com o processo principal.
 *
 * Superfície mínima de propósito: listar os aplicativos que estão tocando,
 * ligar o som de um deles e desligar. Nada de arquivo, processo ou resto do
 * Electron. A página em public/ funciona sem isto — quando roda no navegador,
 * `window.transmissor` simplesmente não existe e a opção não aparece. */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('transmissor', {
  som: {
    disponivel: () => ipcRenderer.invoke('som:disponivel'),
    aplicativos: () => ipcRenderer.invoke('som:aplicativos'),
    ligar: alvo => ipcRenderer.invoke('som:ligar', alvo),
    desligar: () => ipcRenderer.invoke('som:desligar'),
  },
});
