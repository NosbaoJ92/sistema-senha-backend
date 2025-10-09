const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);

// --- Configuração CORS ---
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// =========================================================
// VARIÁVEIS DE ESTADO GLOBAL
// =========================================================
let normalCounter = 0;
let priorityCounter = 0;
let normalQueue = [];
let priorityQueue = [];
let lastCalledTickets = [];
let callHistory = [];

const MAX_PANEL_CALLS = 4;
const MAX_HISTORY = 50;

// =========================================================
// FUNÇÃO AUXILIAR: Broadcast geral do estado
// =========================================================
function broadcastQueueState() {
    const waitingQueueCombined = [...priorityQueue, ...normalQueue];
    const state = {
        normalQueue,
        priorityQueue,
        lastCalledTickets,
        waitingQueue: waitingQueueCombined
    };
    io.emit('filas_atualizadas', state);
    console.log(`[Broadcast] Filas atualizadas enviadas. Total em espera: ${waitingQueueCombined.length}`);
}

// =========================================================
// FUNÇÃO DE GERAÇÃO DE RELATÓRIO DIÁRIO
// =========================================================
function gerarRelatorioDoDia() {
    if (normalQueue.length === 0 && priorityQueue.length === 0 && callHistory.length === 0) {
        console.log('⚠️ Nenhum dado para gerar relatório diário.');
        return;
    }

    const agora = new Date();
    const dataFormatada = agora.toLocaleDateString('pt-BR');
    const hora = agora.toLocaleTimeString('pt-BR');

    const totalNormal = normalQueue.length;
    const totalPrioritaria = priorityQueue.length;

    const tempos = [];
    callHistory.forEach(ch => {
        const emitida = normalQueue.find(n => `${n.tipo}${n.numero}` === `${ch.tipo === 'prioritaria' ? 'P' : 'N'}${ch.numero}`);
        if (emitida) {
            const diff = (new Date(ch.timestamp) - new Date(emitida.timestamp)) / 60000;
            tempos.push(diff);
        }
    });

    const tempoMedio = tempos.length > 0
        ? (tempos.reduce((a, b) => a + b, 0) / tempos.length).toFixed(2)
        : 0;

    const geradasPorCelular = normalQueue.filter(s => s.origem === 'celular').length +
                              priorityQueue.filter(s => s.origem === 'celular').length;
    const geradasManualmente = normalQueue.filter(s => s.origem !== 'celular').length +
                               priorityQueue.filter(s => s.origem !== 'celular').length;

    const relatorio = {
        data: dataFormatada,
        horaGeracao: hora,
        totalSenhas: totalNormal + totalPrioritaria,
        porTipo: {
            normal: totalNormal,
            prioritaria: totalPrioritaria
        },
        tempoMedioEspera: `${tempoMedio} minutos`,
        geradasPorCelular,
        geradasManualmente
    };

    const pasta = path.join(__dirname, 'relatorios');
    if (!fs.existsSync(pasta)) fs.mkdirSync(pasta);

    const filePath = path.join(pasta, `relatorio-${dataFormatada.replace(/\//g, '-')}.json`);
    fs.writeFileSync(filePath, JSON.stringify(relatorio, null, 2), 'utf-8');

    console.log(`✅ Relatório diário salvo: ${filePath}`);
}

// =========================================================
// FUNÇÃO: Reiniciar contadores e filas (meia-noite)
// =========================================================
function resetarSistemaDiariamente() {
    console.log('🔄 Reiniciando sistema diário...');
    gerarRelatorioDoDia();

    normalCounter = 0;
    priorityCounter = 0;
    normalQueue = [];
    priorityQueue = [];
    lastCalledTickets = [];
    callHistory = [];

    broadcastQueueState();
}

// Verificação automática a cada minuto
let ultimoDia = new Date().getDate();
setInterval(() => {
    const hoje = new Date().getDate();
    if (hoje !== ultimoDia) {
        resetarSistemaDiariamente();
        ultimoDia = hoje;
    }
}, 60000);

// =========================================================
// SOCKET.IO - EVENTOS PRINCIPAIS
// =========================================================
io.on('connection', (socket) => {
    console.log(`[Conexão] Novo cliente conectado: ${socket.id}`);

    socket.emit('estado_inicial', {
        normalQueue,
        priorityQueue,
        lastCalledTickets,
        waitingQueue: [...priorityQueue, ...normalQueue],
        callHistory
    });

    // 1. EMISSÃO DE SENHA
    socket.on('emitir_senha_usuario', (tipo, callback, origem = 'manual') => {
        if (tipo !== 'normal' && tipo !== 'prioritaria') {
            if (typeof callback === 'function') callback({ error: true, message: 'Tipo de senha inválido.' });
            return;
        }

        let numeroFormatado, newTicket = null;

        if (tipo === 'normal') {
            normalCounter++;
            numeroFormatado = String(normalCounter).padStart(3, '0');
            newTicket = {
                tipo: 'N',
                numero: numeroFormatado,
                categoria: 'NORMAL',
                origem,
                hora: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
                data: new Date().toLocaleDateString('pt-BR'),
                timestamp: Date.now()
            };
            normalQueue.push(newTicket);
        } else {
            priorityCounter++;
            numeroFormatado = String(priorityCounter).padStart(3, '0');
            newTicket = {
                tipo: 'P',
                numero: numeroFormatado,
                categoria: 'PRIORITÁRIA',
                origem,
                hora: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
                data: new Date().toLocaleDateString('pt-BR'),
                timestamp: Date.now()
            };
            priorityQueue.push(newTicket);
        }

        console.log(`[Senha Emitida] ${newTicket.tipo}${newTicket.numero} (${origem})`);
        broadcastQueueState();

        if (typeof callback === 'function') {
            callback({ success: true, ticket: newTicket, numero: newTicket.numero });
        }
    });

    // 2. CHAMAR SENHA
    socket.on('chamar_senha', ({ tipo, numero, guiche }) => {
        const tipoPrefixado = tipo === 'prioritaria' ? 'P' : 'N';
        const ticketId = `${tipoPrefixado}${numero}`;

        io.emit('seu_guiche_chamado', { ticket: ticketId, guiche });

        const currentCalled = { tipo, numero, guiche, timestamp: new Date().toISOString() };
        lastCalledTickets.unshift(currentCalled);
        if (lastCalledTickets.length > MAX_PANEL_CALLS) lastCalledTickets.pop();

        io.emit('senha_chamada', { currentCalled });
        console.log(`[Chamada] Senha ${ticketId} chamada pelo Guichê ${guiche}.`);
    });

    // 3. SINCRONIZAÇÃO DAS FILAS
    socket.on('sincronizar_filas_apos_chamada', (data) => {
        normalQueue = Array.isArray(data.normalQueue) ? data.normalQueue : normalQueue;
        priorityQueue = Array.isArray(data.priorityQueue) ? data.priorityQueue : priorityQueue;
        broadcastQueueState();
    });

    // 4. FINALIZAÇÃO DE ATENDIMENTO
    socket.on('finalizar_atendimento', ({ guiche, tipo, numero, timestamp }) => {
        const tipoPrefixado = tipo === 'prioritaria' ? 'P' : 'N';
        const ticket = `${tipoPrefixado}${numero}`;

        const newEntry = { guiche, ticket, tipo, numero, timestamp };
        callHistory.unshift(newEntry);
        if (callHistory.length > MAX_HISTORY) callHistory.pop();

        io.emit('historico_adicionado', newEntry);
        console.log(`[Finalizar] Atendimento finalizado: ${ticket} no Guichê ${guiche}`);
    });

    socket.on('disconnect', () => {
        console.log(`[Desconexão] Cliente desconectado: ${socket.id}`);
    });
});

// =========================================================
// INICIALIZAÇÃO DO SERVIDOR
// =========================================================
const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Servidor Socket.IO rodando na porta ${PORT}`);
});
