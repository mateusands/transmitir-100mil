// Lista as janelas visíveis e o processo dono de cada uma.
//
// Serve para o menu de som saber o que oferecer: no Windows a captura é por
// PID, e a única coisa que a pessoa reconhece é o título da janela.
//
// Saída: uma linha por janela, `pid<TAB>título`, em UTF-8.
// Uso:   janelas.exe

#include <windows.h>
#include <io.h>
#include <fcntl.h>
#include <stdio.h>
#include <string>
#include <vector>

// Uma linha por PID: um programa com cinco janelas viraria cinco itens no menu,
// e todos capturariam exatamente o mesmo áudio.
static std::vector<DWORD> vistos;

static bool jaSaiu(DWORD pid)
{
    for (DWORD p : vistos) if (p == pid) return true;
    vistos.push_back(pid);
    return false;
}

static void escreverUtf8(const std::wstring& texto)
{
    const int tamanho = WideCharToMultiByte(CP_UTF8, 0, texto.c_str(), (int)texto.size(), nullptr, 0, nullptr, nullptr);
    if (tamanho <= 0) return;
    std::string saida((size_t)tamanho, '\0');
    WideCharToMultiByte(CP_UTF8, 0, texto.c_str(), (int)texto.size(), &saida[0], tamanho, nullptr, nullptr);
    fwrite(saida.data(), 1, saida.size(), stdout);
}

static BOOL CALLBACK aCadaJanela(HWND janela, LPARAM)
{
    if (!IsWindowVisible(janela)) return TRUE;
    if (GetWindow(janela, GW_OWNER) != nullptr) return TRUE;   // diálogos e afins

    const int tamanho = GetWindowTextLengthW(janela);
    if (tamanho <= 0) return TRUE;                             // sem título não dá para reconhecer

    std::wstring titulo((size_t)tamanho + 1, L'\0');
    const int lido = GetWindowTextW(janela, &titulo[0], tamanho + 1);
    if (lido <= 0) return TRUE;
    titulo.resize((size_t)lido);

    DWORD pid = 0;
    GetWindowThreadProcessId(janela, &pid);
    if (!pid || jaSaiu(pid)) return TRUE;

    // TAB é o separador porque título de janela pode ter praticamente tudo,
    // menos tabulação — e assim quem lê não precisa de escape nenhum
    printf("%lu\t", (unsigned long)pid);
    escreverUtf8(titulo);
    printf("\n");
    return TRUE;
}

int main()
{
    _setmode(_fileno(stdout), _O_BINARY);   // o UTF-8 sai byte a byte, sem tradução
    EnumWindows(aCadaJanela, 0);
    fflush(stdout);
    return 0;
}
