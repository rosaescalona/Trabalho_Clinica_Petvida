/* =========================================================
   PetVida — camada de dados
   Persistência local (localStorage) + dados de demonstração.
   Nenhuma credencial ou chave de API é usada no projeto.
   ========================================================= */

const STORAGE_KEY = 'petvida:v1';

/* ---------- Utilitários de data ---------- */
const DateUtil = {
  iso(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  },
  today() { return DateUtil.iso(new Date()); },
  addDays(isoStr, n) {
    const [y, m, d] = isoStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + n);
    return DateUtil.iso(dt);
  },
  diffDays(a, b) {
    const pa = new Date(a + 'T00:00:00');
    const pb = new Date(b + 'T00:00:00');
    return Math.round((pb - pa) / 86400000);
  },
  toMin(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  },
  toHHMM(min) {
    return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  },
  label(isoStr) {
    const [y, m, d] = isoStr.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('pt-BR', {
      weekday: 'long', day: '2-digit', month: 'long'
    });
  },
  short(isoStr) {
    const [y, m, d] = isoStr.split('-');
    return `${d}/${m}/${y}`;
  }
};

/* ---------- Horário de funcionamento ---------- */
const HORARIO = { abre: 8 * 60, fecha: 18 * 60, passo: 30 };

/* ---------- Dados de demonstração ---------- */
function gerarSeed() {
  const hoje = DateUtil.today();
  const d = (n) => DateUtil.addDays(hoje, n);

  const equipe = [
    { id: 'gabriel', nome: 'Dr. Gabriel Santos', curto: 'Dr. Gabriel', area: 'saude' },
    { id: 'camila', nome: 'Dra. Camila Paes', curto: 'Dra. Camila', area: 'saude' },
    { id: 'renata', nome: 'Dra. Renata Lima (plantão)', curto: 'Dra. Renata', area: 'saude' },
    { id: 'paulo', nome: 'Dr. Paulo Moura (plantão)', curto: 'Dr. Paulo', area: 'saude' },
    { id: 'juliana', nome: 'Juliana (tosa)', curto: 'Juliana', area: 'estetica' },
    { id: 'marcos', nome: 'Marcos (tosa)', curto: 'Marcos', area: 'estetica' },
    { id: 'tati', nome: 'Tati (tosa)', curto: 'Tati', area: 'estetica' }
  ];

  const servicos = [
    { id: 'consulta', nome: 'Consulta', area: 'saude', duracao: 30, preco: 150 },
    { id: 'retorno', nome: 'Retorno', area: 'saude', duracao: 30, preco: 0 },
    { id: 'vacina', nome: 'Vacinação', area: 'saude', duracao: 30, preco: 120 },
    { id: 'cirurgia', nome: 'Cirurgia de pequeno porte', area: 'saude', duracao: 120, preco: 900 },
    { id: 'banho', nome: 'Banho', area: 'estetica', duracao: 60, preco: 70 },
    { id: 'banho-tosa', nome: 'Banho e tosa', area: 'estetica', duracao: 90, preco: 110 },
    { id: 'tosa-higienica', nome: 'Tosa higiênica', area: 'estetica', duracao: 30, preco: 45 }
  ];

  const pets = [
    {
      id: 'p1', nome: 'Thor', especie: 'Cão', raca: 'Golden Retriever', porte: 'Grande',
      tutor: { nome: 'Mariana Alves', telefone: '41991234567' }, cicloBanho: 15,
      vacinas: [
        { nome: 'V10', aplicada: d(-350), proxima: d(15) },
        { nome: 'Antirrábica', aplicada: d(-200), proxima: d(165) }
      ],
      historico: [
        { data: d(-16), area: 'estetica', titulo: 'Banho e tosa', nota: 'Pelagem com nós no peito.', por: 'Juliana' },
        { data: d(-40), area: 'saude', titulo: 'Consulta', nota: 'Otite leve tratada. Retorno se houver coceira.', por: 'Dr. Gabriel' }
      ]
    },
    {
      id: 'p2', nome: 'Mel', especie: 'Cão', raca: 'Shih-tzu', porte: 'Pequeno',
      tutor: { nome: 'Carlos Menezes', telefone: '41998765432' }, cicloBanho: 7,
      vacinas: [
        { nome: 'V10', aplicada: d(-372), proxima: d(-7) },
        { nome: 'Antirrábica', aplicada: d(-372), proxima: d(-7) }
      ],
      historico: [
        { data: d(-8), area: 'estetica', titulo: 'Banho', nota: 'Pele avermelhada na barriga.', por: 'Marcos' }
      ]
    },
    {
      id: 'p3', nome: 'Luna', especie: 'Gato', raca: 'SRD', porte: 'Pequeno',
      tutor: { nome: 'Fernanda Rocha', telefone: '41988887777' }, cicloBanho: 0,
      vacinas: [{ nome: 'V4 felina', aplicada: d(-340), proxima: d(25) }],
      historico: [
        { data: d(-60), area: 'saude', titulo: 'Castração', nota: 'Procedimento sem intercorrências.', por: 'Dra. Camila' }
      ]
    },
    {
      id: 'p4', nome: 'Bob', especie: 'Cão', raca: 'Poodle', porte: 'Médio',
      tutor: { nome: 'Ricardo Souza', telefone: '41987651234' }, cicloBanho: 14,
      vacinas: [{ nome: 'V10', aplicada: d(-100), proxima: d(265) }],
      historico: [
        { data: d(-13), area: 'estetica', titulo: 'Banho e tosa', nota: 'Tudo certo.', por: 'Tati' }
      ]
    },
    {
      id: 'p5', nome: 'Nina', especie: 'Cão', raca: 'Lhasa Apso', porte: 'Pequeno',
      tutor: { nome: 'Patrícia Gomes', telefone: '41996543210' }, cicloBanho: 10,
      vacinas: [{ nome: 'V10', aplicada: d(-360), proxima: d(5) }],
      historico: [
        { data: d(-21), area: 'saude', titulo: 'Consulta', nota: 'Dermatite. Retorno em 3 semanas.', por: 'Dra. Camila' }
      ]
    },
    {
      id: 'p6', nome: 'Pipoca', especie: 'Cão', raca: 'Spitz Alemão', porte: 'Pequeno',
      tutor: { nome: 'João Pereira', telefone: '41995551122' }, cicloBanho: 15,
      vacinas: [{ nome: 'V10', aplicada: d(-30), proxima: d(335) }],
      historico: []
    }
  ];

  pets.push({
    id: 'p7', nome: 'Fred', especie: 'Cão', raca: 'Beagle', porte: 'Médio',
    tutor: { nome: 'Luciana Prado', telefone: '41994442211' }, cicloBanho: 14,
    vacinas: [{ nome: 'V10', aplicada: d(-150), proxima: d(215) }],
    historico: [
      { data: d(-13), area: 'estetica', titulo: 'Banho', nota: 'Unhas cortadas.', por: 'Juliana' }
    ]
  });

  const ag = (id, petId, servicoId, staffId, data, inicio, status = 'agendado') => {
    const s = servicos.find(x => x.id === servicoId);
    return { id, petId, servicoId, staffId, data, inicio, duracao: s.duracao, status, obs: '' };
  };

  const agendamentos = [
    ag('a1', 'p1', 'banho-tosa', 'juliana', hoje, '09:00', 'confirmado'),
    ag('a2', 'p2', 'banho', 'marcos', hoje, '09:00', 'confirmado'),
    ag('a3', 'p4', 'banho-tosa', 'tati', hoje, '10:00'),
    ag('a4', 'p3', 'consulta', 'camila', hoje, '09:30', 'confirmado'),
    ag('a5', 'p5', 'retorno', 'camila', hoje, '11:00'),
    ag('a6', 'p6', 'vacina', 'gabriel', hoje, '10:00'),
    ag('a7', 'p2', 'consulta', 'gabriel', hoje, '14:00'),
    ag('a8', 'p1', 'consulta', 'renata', hoje, '15:00'),
    ag('a9', 'p6', 'banho', 'juliana', hoje, '13:00'),
    ag('a10', 'p5', 'banho', 'marcos', d(1), '09:00'),
    ag('a11', 'p4', 'consulta', 'gabriel', d(1), '10:30'),
    ag('a12', 'p3', 'vacina', 'camila', d(1), '14:00')
  ];

  const alertas = [
    { id: 'al1', petId: 'p2', data: d(-8), nota: 'Pele avermelhada na barriga.', por: 'Marcos', visto: false }
  ];

  return { versao: 1, equipe, servicos, pets, agendamentos, alertas };
}

/* ---------- Persistência ---------- */
const Store = {
  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const db = JSON.parse(raw);
        const ok = db && db.versao === 1 && ['equipe', 'servicos', 'pets', 'agendamentos', 'alertas']
          .every(k => Array.isArray(db[k]));
        if (ok) return db;
      }
    } catch (e) { /* armazenamento indisponível: segue com seed em memória */ }
    const seed = gerarSeed();
    Store.save(seed);
    return seed;
  },
  save(db) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(db)); } catch (e) { /* ignora */ }
  },
  reset() {
    const seed = gerarSeed();
    Store.save(seed);
    return seed;
  }
};
