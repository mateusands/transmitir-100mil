// Declara o que o SDK do Windows só passou a trazer no build 20348, para o
// código compilar também onde esse header não existe — o mingw-w64, por
// exemplo, ainda não tem o audioclientactivationparams.h.
//
// Nada aqui é invenção: são as declarações públicas da API de process
// loopback, documentadas pela Microsoft. Onde o header verdadeiro existe, ele
// vence e este arquivo não define nada.
//
//   https://learn.microsoft.com/windows/win32/api/audioclientactivationparams/
//
// Precisar disto não muda o requisito de execução: a API só existe a partir do
// Windows 10 build 20348. Declarar o tipo faz compilar, não faz funcionar em
// sistema velho — lá o ActivateAudioInterfaceAsync devolve erro, e o captura.exe
// sai com código diferente de zero, que é como o app descobre.

#pragma once

#if defined(__has_include)
#  if __has_include(<audioclientactivationparams.h>)
#    include <audioclientactivationparams.h>
#    define TRANSMISSOR_TEM_SDK_LOOPBACK 1
#  endif
#else
#  include <audioclientactivationparams.h>
#  define TRANSMISSOR_TEM_SDK_LOOPBACK 1
#endif

#ifndef TRANSMISSOR_TEM_SDK_LOOPBACK

typedef enum AUDIOCLIENT_ACTIVATION_TYPE
{
    AUDIOCLIENT_ACTIVATION_TYPE_DEFAULT = 0,
    AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK = 1
} AUDIOCLIENT_ACTIVATION_TYPE;

typedef enum PROCESS_LOOPBACK_MODE
{
    PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE = 0,
    PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE = 1
} PROCESS_LOOPBACK_MODE;

typedef struct AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS
{
    DWORD TargetProcessId;
    PROCESS_LOOPBACK_MODE ProcessLoopbackMode;
} AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS;

typedef struct AUDIOCLIENT_ACTIVATION_PARAMS
{
    AUDIOCLIENT_ACTIVATION_TYPE ActivationType;
    union
    {
        AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS ProcessLoopbackParams;
    } DUMMYUNIONNAME;
} AUDIOCLIENT_ACTIVATION_PARAMS;

// o "dispositivo" que não é dispositivo: é o que diz ao Windows para capturar
// por processo em vez de por placa de som
#define VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK L"VAD\\Process_Loopback"

#endif  // TRANSMISSOR_TEM_SDK_LOOPBACK

// Insere conversor de taxa e de canais quando o formato pedido difere do que o
// motor de áudio usa. Sem ele o Initialize falha em vez de converter.
#ifndef AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM
#  define AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM 0x80000000
#endif
