// server/index.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
    methods: ['GET', 'POST'],
  },
});

// === ESTADO CENTRALIZADO ===
let currentCalled = null; 
let historyQueue = []; 
let normalCount = 1;
let priorityCount = 1;
let normalQueue = []; 
let priorityQueue = [];
let patientsWaiting = []; // Mapeamento de { ticket: 'N001', socketId: 'xyz123' }

// Função para formatar a senha (ex: N001, P005)
const formatarSenha = (tipo, count) => {
    return {
        tipo: tipo === 'normal' ? 'N' : 'P',
        numero: count.toString().padStart(3, '0')
    };
};

io.on('connection', (socket) => {
  console.log('Um novo cliente se conectou:', socket.id);

  // 1. Enviar o estado inicial
  socket.emit('estado_inicial', { 
      currentCalled, 
      historyQueue, 
      normalQueue, 
      priorityQueue 
  });

  // 2. RECEBER a emissão do Smartphone do Usuário (e guarda o ID do Socket)
  socket.on('emitir_senha_usuario', (tipo, callback) => {
    try {
        let novaSenha;
        
        if (tipo === 'normal') {
            novaSenha = formatarSenha('normal', normalCount);
            normalQueue.push(novaSenha);
            normalCount++;
        } else if (tipo === 'prioritaria') {
            novaSenha = formatarSenha('prioritaria', priorityCount);
            priorityQueue.push(novaSenha);
            priorityCount++;
        } else {
            return callback({ error: 'Tipo inválido' });
        }

        // Mapeia a senha ao ID do Socket do paciente
        patientsWaiting.push({
            ticket: `${novaSenha.tipo}${novaSenha.numero}`,
            socketId: socket.id
        });
        
        // Notifica todos os operadores que a fila mudou
        io.emit('filas_atualizadas', { normalQueue, priorityQueue });

        callback(novaSenha); 

    } catch (error) {
        console.error('Erro ao processar a emissão de senha:', error);
        callback({ error: 'Erro interno do servidor ao emitir senha.' });
    }
  });

  // 3. RECEBER a chamada de senha do Operador
  socket.on('chamar_senha', (data) => {
    console.log('Chamada recebida:', data);
    
    currentCalled = data;
    
    historyQueue = [{ ...currentCalled, horario: Date.now() }, ...historyQueue].slice(0, 10);

    // ENVIA o novo estado do PAINEL para TODOS os clientes
    io.emit('senha_chamada', { currentCalled, historyQueue });
    
    // ----------- LÓGICA DE NOTIFICAÇÃO DO PACIENTE -----------
    const calledTicket = `${data.tipo}${data.numero}`;
    
    const patient = patientsWaiting.find(p => p.ticket === calledTicket);

    if (patient) {
        // O paciente NÃO é removido daqui, permitindo rechamadas
        
        // Envia uma notificação TARGETED para o celular do paciente
        io.to(patient.socketId).emit('seu_guiche_chamado', {
            guiche: data.guiche,
            ticket: calledTicket 
        });
    }
    // --------------------------------------------------------
  });

  // 4. Sincronização de filas após chamada do operador
  socket.on('sincronizar_filas_apos_chamada', (data) => {
      normalQueue = data.normalQueue;
      priorityQueue = data.priorityQueue;
      
      // Notifica os outros operadores sobre a mudança de fila
      socket.broadcast.emit('filas_atualizadas', { normalQueue, priorityQueue });
  });
  
  // 5. NOVO EVENTO: Remove o paciente da lista de espera ao finalizar o atendimento
  socket.on('finalizar_atendimento_paciente', (ticket) => {
      patientsWaiting = patientsWaiting.filter(p => p.ticket !== ticket);
  });

  socket.on('disconnect', () => {
    console.log('Cliente desconectado:', socket.id);
    // Remove da lista de espera se o paciente fechar o app
    patientsWaiting = patientsWaiting.filter(p => p.socketId !== socket.id);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Servidor Socket.IO rodando na porta ${PORT}`);
});