const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// --- Cria servidor HTTP --- 
const server = http.createServer(app);

// --- Configura Socket.IO ---
const io = new Server(server, {
    cors: {
        origin: "*", // Ajuste para seu domínio se necessário
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling']
});

// --- Variáveis de estado simples ---
let normalQueue = [];
let priorityQueue = [];
let callHistory = [];
let currentCalls = {};

// --- Eventos Socket.IO ---
io.on('connection', (socket) => {
    console.log(`[Socket] Novo cliente conectado: ${socket.id}`);

    // Envia estado inicial
    socket.emit('estado_inicial', { normalQueue, priorityQueue, callHistory, currentOperatorCall: null });

    // Recebe emissão de senha pelo operador
    socket.on('chamar_senha', ({ tipo, numero, guiche }) => {
        console.log(`Chamada: ${tipo}${numero} pelo guichê ${guiche}`);
        currentCalls[guiche] = { tipo, numero };
        io.emit('senha_chamada', { currentCalled: { tipo, numero } });
        // Atualiza filas
        normalQueue = normalQueue.filter(s => !(s.tipo === tipo && s.numero === numero));
        priorityQueue = priorityQueue.filter(s => !(s.tipo === tipo && s.numero === numero));
        io.emit('filas_atualizadas', { normalQueue, priorityQueue });
    });

    // Finalizar atendimento
    socket.on('finalizar_atendimento', ({ ticket, tipo, numero, guiche, timestamp }) => {
        console.log(`Atendimento finalizado: ${ticket} no guichê ${guiche}`);
        callHistory.unshift({ ticket, tipo, numero, guiche, timestamp });
        delete currentCalls[guiche];
        io.emit('historico_adicionado', { ticket, tipo, numero, guiche, timestamp });
        io.emit('guiche_livre_confirmado', { guiche });
    });

    // Emitir senha de usuário (exemplo simplificado)
    socket.on('emitir_senha_usuario', (tipo, callback) => {
        const numero = tipo === 'prioritaria' ? priorityQueue.length + 1 : normalQueue.length + 1;
        const ticket = { tipo, numero, data: new Date().toLocaleDateString(), hora: new Date().toLocaleTimeString() };
        if (tipo === 'prioritaria') priorityQueue.push(ticket);
        else normalQueue.push(ticket);
        io.emit('filas_atualizadas', { normalQueue, priorityQueue });
        callback({ success: true, ticket });
    });

    socket.on('sincronizar_filas_apos_chamada', ({ normalQueue: nq, priorityQueue: pq }) => {
        normalQueue = nq;
        priorityQueue = pq;
        io.emit('filas_atualizadas', { normalQueue, priorityQueue });
    });

    socket.on('disconnect', () => {
        console.log(`[Socket] Cliente desconectado: ${socket.id}`);
    });
});

// --- Porta dinâmica para Render ---
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
