// Captura o áudio de um processo no Windows e despeja PCM cru no stdout.
//
// Baseado no exemplo ApplicationLoopback da Microsoft, que é MIT:
//   https://github.com/microsoft/Windows-classic-samples
//   Copyright (c) Microsoft Corporation. Licensed under the MIT License.
//
// O que mudamos e por quê:
//   - o exemplo grava um .wav com o Media Foundation; nós escrevemos PCM cru no
//     stdout, porque quem consome é o processo pai. Some a dependência do
//     MFPlat e do IMFSinkWriter.
//   - o exemplo usa a WIL e a WRL (bibliotecas de header da Microsoft) para
//     ponteiro COM e para o objeto de callback; aqui isso é feito à mão, em
//     umas 40 linhas, para não trazer biblioteca nenhuma.
//   - 48000 Hz em vez dos 44100 do exemplo: é a taxa que o worklet da página
//     espera, e evitar reamostragem no caminho.
//
// Uso:  captura.exe <pid>
// Saída: PCM 16 bits com sinal, 2 canais, 48000 Hz, intercalado, no stdout.

#include <windows.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <audioclientactivationparams.h>
#include <io.h>
#include <fcntl.h>
#include <stdio.h>

static const int CANAIS = 2;
static const int TAXA = 48000;
static const int BITS = 16;

// Espera a ativação assíncrona terminar. É a única razão de existir um objeto
// COM aqui — o resto do programa é sequencial.
class Ativacao : public IActivateAudioInterfaceCompletionHandler
{
public:
    HANDLE pronto = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    HRESULT resultado = E_UNEXPECTED;
    IAudioClient* cliente = nullptr;

    ~Ativacao() { if (pronto) CloseHandle(pronto); }

    STDMETHODIMP QueryInterface(REFIID riid, void** saida) override
    {
        if (riid == __uuidof(IUnknown) ||
            riid == __uuidof(IActivateAudioInterfaceCompletionHandler) ||
            riid == __uuidof(IAgileObject))
        {
            *saida = static_cast<IActivateAudioInterfaceCompletionHandler*>(this);
            AddRef();
            return S_OK;
        }
        *saida = nullptr;
        return E_NOINTERFACE;
    }
    // o objeto vive na pilha do main enquanto a captura roda; a contagem existe
    // só para satisfazer o COM, e ninguém o destrói por ela
    STDMETHODIMP_(ULONG) AddRef() override { return InterlockedIncrement(&refs); }
    STDMETHODIMP_(ULONG) Release() override { return InterlockedDecrement(&refs); }

    STDMETHODIMP ActivateCompleted(IActivateAudioInterfaceAsyncOperation* op) override
    {
        IUnknown* desconhecido = nullptr;
        HRESULT hr = op->GetActivateResult(&resultado, &desconhecido);
        if (SUCCEEDED(hr) && SUCCEEDED(resultado) && desconhecido)
        {
            resultado = desconhecido->QueryInterface(__uuidof(IAudioClient), (void**)&cliente);
            desconhecido->Release();
        }
        else if (SUCCEEDED(hr) && SUCCEEDED(resultado))
        {
            resultado = E_UNEXPECTED;
        }
        SetEvent(pronto);
        return S_OK;
    }

private:
    LONG refs = 1;
};

static void erro(const char* texto, HRESULT hr)
{
    fprintf(stderr, "captura: %s (hr=0x%08lx)\n", texto, (unsigned long)hr);
}

int wmain(int argc, wchar_t** argv)
{
    if (argc < 2)
    {
        fprintf(stderr, "uso: captura.exe <pid>\n");
        return 2;
    }
    DWORD pid = (DWORD)_wtoi(argv[1]);

    // stdout em binário: sem isto o Windows troca 0x0A por 0x0D 0x0A e corrompe
    // o áudio de um jeito que parece ruído, não falha
    _setmode(_fileno(stdout), _O_BINARY);

    HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    if (FAILED(hr)) { erro("CoInitializeEx", hr); return 1; }

    AUDIOCLIENT_ACTIVATION_PARAMS parametros = {};
    parametros.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
    parametros.ProcessLoopbackParams.TargetProcessId = pid;
    parametros.ProcessLoopbackParams.ProcessLoopbackMode =
        PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE;

    PROPVARIANT blob = {};
    blob.vt = VT_BLOB;
    blob.blob.cbSize = sizeof(parametros);
    blob.blob.pBlobData = (BYTE*)&parametros;

    Ativacao ativacao;
    IActivateAudioInterfaceAsyncOperation* operacao = nullptr;
    hr = ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
                                     __uuidof(IAudioClient), &blob, &ativacao, &operacao);
    if (FAILED(hr)) { erro("ActivateAudioInterfaceAsync", hr); return 1; }
    WaitForSingleObject(ativacao.pronto, INFINITE);
    if (operacao) operacao->Release();
    if (FAILED(ativacao.resultado) || !ativacao.cliente)
    {
        erro("ativacao do loopback por processo", ativacao.resultado);
        return 1;
    }

    IAudioClient* cliente = ativacao.cliente;

    WAVEFORMATEX formato = {};
    formato.wFormatTag = WAVE_FORMAT_PCM;
    formato.nChannels = CANAIS;
    formato.nSamplesPerSec = TAXA;
    formato.wBitsPerSample = BITS;
    formato.nBlockAlign = formato.nChannels * formato.wBitsPerSample / 8;
    formato.nAvgBytesPerSec = formato.nSamplesPerSec * formato.nBlockAlign;

    // AUTOCONVERTPCM porque o processo pode estar tocando em qualquer taxa; sem
    // ele o Initialize falha em vez de converter
    hr = cliente->Initialize(AUDCLNT_SHAREMODE_SHARED,
                             AUDCLNT_STREAMFLAGS_LOOPBACK |
                             AUDCLNT_STREAMFLAGS_EVENTCALLBACK |
                             AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
                             0, 0, &formato, nullptr);
    if (FAILED(hr)) { erro("IAudioClient::Initialize", hr); return 1; }

    HANDLE temAudio = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    hr = cliente->SetEventHandle(temAudio);
    if (FAILED(hr)) { erro("SetEventHandle", hr); return 1; }

    IAudioCaptureClient* captura = nullptr;
    hr = cliente->GetService(__uuidof(IAudioCaptureClient), (void**)&captura);
    if (FAILED(hr)) { erro("GetService(IAudioCaptureClient)", hr); return 1; }

    hr = cliente->Start();
    if (FAILED(hr)) { erro("IAudioClient::Start", hr); return 1; }

    while (true)
    {
        if (WaitForSingleObject(temAudio, 2000) == WAIT_FAILED) break;

        /* Um evento não corresponde a um pacote: o motor de áudio pode ter
           acumulado vários. Ler até acabar, senão a fila cresce e o som atrasa
           cada vez mais — comportamento que parece "travando", não "faltando". */
        UINT32 quadros = 0;
        while (SUCCEEDED(captura->GetNextPacketSize(&quadros)) && quadros > 0)
        {
            BYTE* dados = nullptr;
            DWORD marcas = 0;
            if (FAILED(captura->GetBuffer(&dados, &quadros, &marcas, nullptr, nullptr))) break;

            const size_t bytes = (size_t)quadros * formato.nBlockAlign;
            if (marcas & AUDCLNT_BUFFERFLAGS_SILENT)
            {
                // silêncio vem com o ponteiro sujo; escrever zeros mantém o
                // relógio de quem consome andando
                static const BYTE zeros[4096] = {};
                for (size_t escrito = 0; escrito < bytes; escrito += sizeof(zeros))
                {
                    const size_t pedaco = min(sizeof(zeros), bytes - escrito);
                    if (fwrite(zeros, 1, pedaco, stdout) != pedaco) { captura->ReleaseBuffer(quadros); goto fim; }
                }
            }
            else if (fwrite(dados, 1, bytes, stdout) != bytes)
            {
                captura->ReleaseBuffer(quadros);
                goto fim;   // o pai fechou o cano: hora de sair
            }
            fflush(stdout);
            captura->ReleaseBuffer(quadros);
        }
    }

fim:
    cliente->Stop();
    captura->Release();
    cliente->Release();
    CloseHandle(temAudio);
    CoUninitialize();
    return 0;
}
