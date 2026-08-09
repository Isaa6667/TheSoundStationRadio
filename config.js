// Configuração do player — edite este arquivo para apontar para a sua rádio.
//
// Se você estiver rodando via Docker, NÃO edite aqui: este arquivo é gerado
// automaticamente na subida do container a partir das variáveis de ambiente
// (RADIO_NAME, URL_STREAMING, ...). Veja a seção Docker do README.
//
// Se este arquivo não existir, o js/script.js cai nos valores padrão dele.
window.RADIO_CONFIG = {
    // Nome da rádio, exibido no topo e no título da página
    RADIO_NAME: 'Jailson Web Rádio',

    // URL do stream. Suporta ICECAST, ZENO, SHOUTCAST, RADIOJAR e outros.
    URL_STREAMING: 'https://stream.zeno.fm/yn65fsaurfhvv',

    // Opcionais: por padrão as URLs da API de metadados são derivadas do
    // URL_STREAMING. Só preencha se você usa a sua própria API.
    // API_URL: '',
    // FALLBACK_API_URL: '',

    // Opcionais: sobrescrevem as variáveis de tema do css/style.css
    // ACCENT_COLOR: '#00e1e7',
    // BG_COLOR: '#0b0e13',
};
