/* =========================================================
   PetVida — lógica da aplicação
   Views: Agenda, Pets (ficha integrada), Lembretes, Painel
   ========================================================= */

let db = Store.load();

const state = {
  view: 'agenda',
  data: DateUtil.today(),
  filtro: 'todos',      // todos | saude | estetica
  petSel: null,
  busca: '',
  agSel: null           // agendamento aberto no detalhe
};

/* ---------- Helpers ---------- */
const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));
const brl = (n) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const pet = (id) => db.pets.find(p => p.id === id);
const staff = (id) => db.equipe.find(s => s.id === id);
const servico = (id) => db.servicos.find(s => s.id === id);
const AREA_NOME = { saude: 'Saúde', estetica: 'Estética' };
const STATUS_NOME = {
  agendado: 'Agendado', confirmado: 'Confirmado', concluido: 'Concluído',
  faltou: 'Não compareceu', cancelado: 'Cancelado'
};

function salvar() { Store.save(db); }

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2800);
}

function waLink(telefone, msg) {
  const num = String(telefone).replace(/\D/g, '');
  return `https://wa.me/55${num}?text=${encodeURIComponent(msg)}`;
}

/* ---------- Regras de negócio ---------- */
function statusVacina(v) {
  const dias = DateUtil.diffDays(DateUtil.today(), v.proxima);
  if (dias < 0) return { tipo: 'vencida', dias, texto: `Vencida há ${-dias} dia${-dias === 1 ? '' : 's'}` };
  if (dias <= 30) return { tipo: 'avencer', dias, texto: dias === 0 ? 'Vence hoje' : `Vence em ${dias} dia${dias === 1 ? '' : 's'}` };
  return { tipo: 'emdia', dias, texto: 'Em dia' };
}

function pendenciasSaude(p) {
  return p.vacinas
    .map(v => ({ ...v, st: statusVacina(v) }))
    .filter(v => v.st.tipo !== 'emdia');
}

function alertasAbertos(petId) {
  return db.alertas.filter(a => a.petId === petId && !a.visto);
}

function ultimoBanho(p) {
  const datas = p.historico.filter(h => h.area === 'estetica').map(h => h.data).sort();
  return datas.length ? datas[datas.length - 1] : null;
}

function ativos(lista) {
  return lista.filter(a => a.status !== 'cancelado' && a.status !== 'faltou');
}

function doDia(data) {
  return ativos(db.agendamentos.filter(a => a.data === data));
}

function sobrepoe(a, inicioMin, fimMin) {
  const ai = DateUtil.toMin(a.inicio);
  return inicioMin < ai + a.duracao && fimMin > ai;
}

/** Verifica choques de horário: mesmo profissional ou mesmo pet. */
function verificarConflito(novo, ignorarId = null) {
  const ini = DateUtil.toMin(novo.inicio);
  const fim = ini + novo.duracao;
  if (fim > HORARIO.fecha) {
    return `O atendimento terminaria às ${DateUtil.toHHMM(fim)}, depois do fechamento (18:00).`;
  }
  const dia = doDia(novo.data).filter(a => a.id !== ignorarId);
  const choqueStaff = dia.find(a => a.staffId === novo.staffId && sobrepoe(a, ini, fim));
  if (choqueStaff) {
    const p = pet(choqueStaff.petId);
    const fimC = DateUtil.toHHMM(DateUtil.toMin(choqueStaff.inicio) + choqueStaff.duracao);
    const prox = proximoLivre(novo.staffId, novo.data, novo.duracao, ini);
    return `${staff(novo.staffId).curto} já atende ${p.nome} das ${choqueStaff.inicio} às ${fimC}.` +
      (prox ? ` Próximo horário livre: ${prox}.` : ' Não há outro horário livre nesse dia.');
  }
  const choquePet = dia.find(a => a.petId === novo.petId && sobrepoe(a, ini, fim));
  if (choquePet) {
    return `${pet(novo.petId).nome} já tem ${servico(choquePet.servicoId).nome.toLowerCase()} às ${choquePet.inicio} com ${staff(choquePet.staffId).curto}.`;
  }
  return null;
}

function proximoLivre(staffId, data, duracao, aPartirMin = HORARIO.abre) {
  const dia = doDia(data).filter(a => a.staffId === staffId);
  for (let t = aPartirMin; t + duracao <= HORARIO.fecha; t += HORARIO.passo) {
    if (!dia.some(a => sobrepoe(a, t, t + duracao))) return DateUtil.toHHMM(t);
  }
  return null;
}

function janelasLivres(staffId, data) {
  const ocupados = doDia(data)
    .filter(a => a.staffId === staffId)
    .map(a => [DateUtil.toMin(a.inicio), DateUtil.toMin(a.inicio) + a.duracao])
    .sort((x, y) => x[0] - y[0]);
  const janelas = [];
  let cursor = HORARIO.abre;
  for (const [i, f] of ocupados) {
    if (i > cursor) janelas.push([cursor, i]);
    cursor = Math.max(cursor, f);
  }
  if (cursor < HORARIO.fecha) janelas.push([cursor, HORARIO.fecha]);
  return janelas;
}

/* ---------- Lembretes ---------- */
function calcularLembretes() {
  const hoje = DateUtil.today();
  const amanha = DateUtil.addDays(hoje, 1);

  const confirmar = db.agendamentos
    .filter(a => a.data === amanha && a.status === 'agendado')
    .sort((a, b) => a.inicio.localeCompare(b.inicio));

  const vacinas = [];
  db.pets.forEach(p => {
    const jaMarcada = db.agendamentos.some(a => a.petId === p.id && a.servicoId === 'vacina' &&
      a.data >= hoje && (a.status === 'agendado' || a.status === 'confirmado'));
    if (!jaMarcada) pendenciasSaude(p).forEach(v => vacinas.push({ p, v }));
  });
  vacinas.sort((a, b) => a.v.st.dias - b.v.st.dias);

  const banhos = db.pets.filter(p => {
    if (!p.cicloBanho) return false;
    const temFuturo = db.agendamentos.some(a =>
      a.petId === p.id && a.data >= hoje && servico(a.servicoId).area === 'estetica' &&
      (a.status === 'agendado' || a.status === 'confirmado'));
    if (temFuturo) return false;
    const ult = ultimoBanho(p);
    if (!ult) return true;
    return DateUtil.diffDays(ult, hoje) >= p.cicloBanho - 2;
  });

  const alertas = db.alertas.filter(a => !a.visto);

  return { confirmar, vacinas, banhos, alertas,
    total: confirmar.length + vacinas.length + banhos.length + alertas.length };
}

function atualizarBadge() {
  const { total } = calcularLembretes();
  const b = $('#badge-lembretes');
  b.hidden = total === 0;
  b.textContent = total;
}

/* =========================================================
   VIEW: AGENDA
   ========================================================= */
const ROW_H = 44; // px por slot de 30 min

function renderAgenda() {
  const el = $('#view-agenda');
  const equipeVisivel = db.equipe.filter(s => state.filtro === 'todos' || s.area === state.filtro);
  const dia = doDia(state.data);
  const slots = (HORARIO.fecha - HORARIO.abre) / HORARIO.passo;
  const ehHoje = state.data === DateUtil.today();

  const resumoSaude = dia.filter(a => servico(a.servicoId).area === 'saude').length;
  const resumoEst = dia.length - resumoSaude;

  let html = `
    <header class="view-head">
      <div>
        <h1 id="t-agenda">Agenda</h1>
        <p class="sub">${esc(DateUtil.label(state.data))}${ehHoje ? ' (hoje)' : ''}</p>
      </div>
      <div class="head-actions">
        <div class="day-nav" role="group" aria-label="Navegar entre dias">
          <button class="btn ghost sm" data-action="dia-ant" aria-label="Dia anterior">‹</button>
          <button class="btn ghost sm" data-action="dia-hoje">Hoje</button>
          <button class="btn ghost sm" data-action="dia-prox" aria-label="Próximo dia">›</button>
        </div>
        <button class="btn primary" data-action="novo-ag">Novo agendamento</button>
      </div>
    </header>

    <div class="toolbar">
      <div class="segmented" role="radiogroup" aria-label="Filtrar por área">
        ${['todos', 'saude', 'estetica'].map(f => `
          <button role="radio" aria-checked="${state.filtro === f}" class="seg ${state.filtro === f ? 'on' : ''}" data-action="filtro" data-f="${f}">
            ${f === 'todos' ? 'Toda a equipe' : AREA_NOME[f]}
          </button>`).join('')}
      </div>
      <p class="tally"><span class="dot saude"></span>${resumoSaude} na saúde <span class="dot estetica"></span>${resumoEst} na estética</p>
    </div>

    <div class="agenda-scroll">
      <div class="agenda" style="--cols:${equipeVisivel.length}; --row:${ROW_H}px; --slots:${slots}">
        <div class="time-col" aria-hidden="true">
          <div class="col-head"></div>
          <div class="col-body">
            ${Array.from({ length: slots }, (_, i) => {
              const t = HORARIO.abre + i * HORARIO.passo;
              return `<div class="time-label">${t % 60 === 0 ? DateUtil.toHHMM(t) : ''}</div>`;
            }).join('')}
          </div>
        </div>`;

  equipeVisivel.forEach(s => {
    const meus = dia.filter(a => a.staffId === s.id);
    html += `
      <div class="col area-${s.area}">
        <div class="col-head"><strong>${esc(s.curto)}</strong><small>${AREA_NOME[s.area]}</small></div>
        <div class="col-body">
          ${Array.from({ length: slots }, (_, i) => {
            const t = DateUtil.toHHMM(HORARIO.abre + i * HORARIO.passo);
            return `<button class="slot" data-action="slot" data-staff="${s.id}" data-t="${t}" aria-label="Agendar às ${t} com ${esc(s.curto)}"></button>`;
          }).join('')}
          ${meus.map(a => blocoAgendamento(a)).join('')}
        </div>
      </div>`;
  });

  html += `</div>`;

  if (ehHoje) {
    const agora = new Date();
    const min = agora.getHours() * 60 + agora.getMinutes();
    if (min >= HORARIO.abre && min <= HORARIO.fecha) {
      html += `<div class="now-line" style="top: calc(var(--head-h) + ${(min - HORARIO.abre) / HORARIO.passo * ROW_H}px)"><span>${DateUtil.toHHMM(min)}</span></div>`;
    }
  }
  html += `</div>`;
  el.innerHTML = html;
}

function blocoAgendamento(a) {
  const p = pet(a.petId);
  const s = servico(a.servicoId);
  const top = (DateUtil.toMin(a.inicio) - HORARIO.abre) / HORARIO.passo * ROW_H;
  const h = a.duracao / HORARIO.passo * ROW_H;
  const pend = pendenciasSaude(p).length > 0;
  const alerta = alertasAbertos(p.id).length > 0;
  const flag = s.area === 'estetica' && pend
    ? '<span class="flag">vacina pendente</span>'
    : (s.area === 'saude' && alerta ? '<span class="flag">obs. da estética</span>' : '');
  return `
    <button class="appt area-${s.area} st-${a.status}${a.duracao <= 30 ? ' short' : ''}" style="top:${top}px; height:${h - 4}px"
      data-action="abrir-ag" data-id="${a.id}">
      <span class="appt-time">${a.inicio}</span>
      <span class="appt-pet">${esc(p.nome)}</span>
      <span class="appt-serv">${esc(s.nome)}</span>
      ${flag}
    </button>`;
}

/* ---------- Detalhe do agendamento ---------- */
function abrirDetalhe(id) {
  const a = db.agendamentos.find(x => x.id === id);
  if (!a) return;
  state.agSel = id;
  const p = pet(a.petId);
  const s = servico(a.servicoId);
  const fim = DateUtil.toHHMM(DateUtil.toMin(a.inicio) + a.duracao);
  const pend = pendenciasSaude(p);
  const alertas = alertasAbertos(p.id);
  const fechado = ['concluido', 'cancelado', 'faltou'].includes(a.status);

  const msg = `Olá, ${p.tutor.nome.split(' ')[0]}! Aqui é da PetVida 🐾 Lembrando: ${s.nome.toLowerCase()} do(a) ${p.nome} em ${DateUtil.short(a.data)} às ${a.inicio}. Podemos confirmar?`;

  let integra = '';
  if (s.area === 'estetica' && pend.length) {
    integra = `<div class="notice warn"><strong>Aproveite a visita:</strong> ${pend.map(v => `${esc(v.nome)} (${v.st.texto.toLowerCase()})`).join(', ')}. Ofereça a aplicação no mesmo dia.</div>`;
  } else if (s.area === 'saude' && alertas.length) {
    integra = `<div class="notice warn"><strong>Observação da estética:</strong> ${alertas.map(x => `${esc(x.nota)} (${esc(x.por)}, ${DateUtil.short(x.data)})`).join('; ')}</div>`;
  }

  $('#detalhe-conteudo').innerHTML = `
    <header class="dialog-head area-${s.area}">
      <div>
        <p class="kicker">${AREA_NOME[s.area]}</p>
        <h2>${esc(s.nome)} de ${esc(p.nome)}</h2>
      </div>
      <button type="button" class="icon-btn" data-close aria-label="Fechar">✕</button>
    </header>
    <div class="dialog-body">
      <dl class="facts">
        <div><dt>Quando</dt><dd>${DateUtil.short(a.data)}, ${a.inicio} às ${fim}</dd></div>
        <div><dt>Profissional</dt><dd>${esc(staff(a.staffId).nome)}</dd></div>
        <div><dt>Tutor</dt><dd>${esc(p.tutor.nome)}</dd></div>
        <div><dt>Situação</dt><dd><span class="pill st-${a.status}">${STATUS_NOME[a.status]}</span></dd></div>
        ${a.obs ? `<div><dt>Observação</dt><dd>${esc(a.obs)}</dd></div>` : ''}
      </dl>
      ${integra}
    </div>
    <footer class="dialog-foot wrap">
      <button class="btn ghost" data-action="ver-ficha" data-pet="${p.id}">Ver ficha do pet</button>
      ${!fechado ? `<a class="btn ghost" href="${waLink(p.tutor.telefone, msg)}" target="_blank" rel="noopener">Lembrar pelo WhatsApp</a>` : ''}
      ${a.status === 'agendado' ? `<button class="btn ghost" data-action="status" data-st="confirmado">Marcar confirmado</button>` : ''}
      ${!fechado ? `<button class="btn ghost danger" data-action="status" data-st="faltou">Não compareceu</button>` : ''}
      ${!fechado ? `<button class="btn ghost danger" data-action="status" data-st="cancelado">Cancelar agendamento</button>` : ''}
      ${!fechado ? `<button class="btn primary" data-action="concluir">Concluir atendimento</button>` : ''}
    </footer>`;
  const dlg = $('#dlg-detalhe');
  if (!dlg.open) dlg.showModal();
}

function mudarStatus(st) {
  const a = db.agendamentos.find(x => x.id === state.agSel);
  if (!a) return;
  a.status = st;
  salvar();
  $('#dlg-detalhe').close();
  renderTudo();
  toast(`${pet(a.petId).nome}: ${STATUS_NOME[st].toLowerCase()}.`);
}

function abrirConcluir() {
  const a = db.agendamentos.find(x => x.id === state.agSel);
  const s = servico(a.servicoId);
  const f = $('#form-concluir');
  f.reset();
  $('#wrap-alerta').hidden = s.area !== 'estetica';
  $('#dlg-detalhe').close();
  $('#dlg-concluir').showModal();
}

function concluir(e) {
  e.preventDefault();
  const a = db.agendamentos.find(x => x.id === state.agSel);
  const p = pet(a.petId);
  const s = servico(a.servicoId);
  const fd = new FormData(e.target);
  const nota = String(fd.get('nota') || '').trim();
  const por = staff(a.staffId).curto;

  a.status = 'concluido';
  p.historico.push({ data: a.data, area: s.area, titulo: s.nome, nota: nota || 'Sem observações.', por });

  if (s.id === 'vacina') {
    p.vacinas.forEach(v => {
      if (statusVacina(v).tipo !== 'emdia') {
        v.aplicada = a.data;
        v.proxima = DateUtil.addDays(a.data, 365);
      }
    });
  }
  if (s.area === 'saude') {
    alertasAbertos(p.id).forEach(x => { x.visto = true; });
  }
  if (s.area === 'estetica' && fd.get('alertarVet')) {
    db.alertas.push({ id: uid('al'), petId: p.id, data: a.data, nota: nota || 'Avaliar o pet.', por, visto: false });
  }
  salvar();
  $('#dlg-concluir').close();
  renderTudo();
  toast(`Atendimento de ${p.nome} salvo no histórico.`);
}

/* ---------- Novo agendamento ---------- */
function abrirAgendar(pre = {}) {
  const f = $('#form-agendar');
  f.reset();
  $('#erro-agendar').hidden = true;

  f.petId.innerHTML = [...db.pets].sort((a, b) => a.nome.localeCompare(b.nome))
    .map(p => `<option value="${p.id}">${esc(p.nome)} (${esc(p.tutor.nome)})</option>`).join('');
  f.servicoId.innerHTML = ['saude', 'estetica'].map(area => `
    <optgroup label="${AREA_NOME[area]}">
      ${db.servicos.filter(s => s.area === area).map(s =>
        `<option value="${s.id}">${esc(s.nome)} (${s.duracao} min)</option>`).join('')}
    </optgroup>`).join('');
  const horas = [];
  for (let t = HORARIO.abre; t < HORARIO.fecha; t += HORARIO.passo) horas.push(DateUtil.toHHMM(t));
  f.inicio.innerHTML = horas.map(h => `<option>${h}</option>`).join('');

  if (pre.petId) f.petId.value = pre.petId;
  if (pre.staffId) {
    const area = staff(pre.staffId).area;
    f.servicoId.value = db.servicos.find(s => s.area === area).id;
  }
  if (pre.servicoId) f.servicoId.value = pre.servicoId;
  f.data.value = pre.data || state.data;
  atualizarProfissionais(pre.staffId);
  if (pre.inicio) f.inicio.value = pre.inicio;
  atualizarAvisoSaude();
  $('#dlg-agendar').showModal();
}

function atualizarProfissionais(prefer) {
  const f = $('#form-agendar');
  const area = servico(f.servicoId.value).area;
  const lista = db.equipe.filter(s => s.area === area);
  const atual = prefer || f.staffId.value;
  f.staffId.innerHTML = lista.map(s => `<option value="${s.id}">${esc(s.nome)}</option>`).join('');
  if (lista.some(s => s.id === atual)) f.staffId.value = atual;
}

function atualizarAvisoSaude() {
  const f = $('#form-agendar');
  const p = pet(f.petId.value);
  const s = servico(f.servicoId.value);
  const aviso = $('#aviso-saude');
  const pend = pendenciasSaude(p);
  const alertas = alertasAbertos(p.id);
  if (s.area === 'estetica' && pend.length) {
    aviso.innerHTML = `<strong>${esc(p.nome)}:</strong> ${pend.map(v => `${esc(v.nome)} ${v.st.texto.toLowerCase()}`).join(', ')}. Ofereça a vacina no mesmo dia do banho.`;
    aviso.hidden = false;
  } else if (s.area === 'saude' && alertas.length) {
    aviso.innerHTML = `<strong>A estética observou:</strong> ${alertas.map(x => esc(x.nota)).join('; ')}`;
    aviso.hidden = false;
  } else {
    aviso.hidden = true;
  }
}

function salvarAgendamento(e) {
  e.preventDefault();
  const f = e.target;
  const s = servico(f.servicoId.value);
  const novo = {
    id: uid('a'),
    petId: f.petId.value,
    servicoId: s.id,
    staffId: f.staffId.value,
    data: f.data.value,
    inicio: f.inicio.value,
    duracao: s.duracao,
    status: 'agendado',
    obs: f.obs.value.trim()
  };
  const erro = $('#erro-agendar');
  if (!novo.data) {
    erro.textContent = 'Escolha a data do atendimento.';
    erro.hidden = false;
    return;
  }
  const conflito = verificarConflito(novo);
  if (conflito) {
    erro.textContent = conflito;
    erro.hidden = false;
    return;
  }
  db.agendamentos.push(novo);
  salvar();
  $('#dlg-agendar').close();
  state.data = novo.data;
  irPara('agenda');
  toast(`${pet(novo.petId).nome} agendado às ${novo.inicio} com ${staff(novo.staffId).curto}.`);
}

/* =========================================================
   VIEW: PETS (ficha integrada saúde + estética)
   ========================================================= */
function renderPets() {
  const el = $('#view-pets');
  const termo = state.busca.trim().toLowerCase();
  const lista = [...db.pets]
    .filter(p => !termo || p.nome.toLowerCase().includes(termo) || p.tutor.nome.toLowerCase().includes(termo))
    .sort((a, b) => a.nome.localeCompare(b.nome));
  if (!state.petSel && db.pets.length) {
    const peso = (p) => pendenciasSaude(p).length + alertasAbertos(p.id).length;
    state.petSel = [...db.pets].sort((a, b) => peso(b) - peso(a))[0].id;
  }

  el.innerHTML = `
    <header class="view-head">
      <div>
        <h1 id="t-pets">Pets</h1>
        <p class="sub">Saúde e estética no mesmo histórico</p>
      </div>
      <div class="head-actions">
        <button class="btn primary" data-action="novo-pet">Cadastrar pet</button>
      </div>
    </header>
    <div class="pets-layout">
      <div class="pet-list">
        <label class="search">
          <span class="sr-only">Buscar pet ou tutor</span>
          <input type="search" id="busca-pet" placeholder="Buscar pet ou tutor" value="${esc(state.busca)}">
        </label>
        <ul>
          ${lista.length ? lista.map(p => {
            const pend = pendenciasSaude(p).length + alertasAbertos(p.id).length;
            return `<li><button class="pet-item ${state.petSel === p.id ? 'on' : ''}" data-action="sel-pet" data-pet="${p.id}">
              <span class="avatar">${esc(p.nome[0])}</span>
              <span><strong>${esc(p.nome)}</strong><small>${esc(p.tutor.nome)}</small></span>
              ${pend ? `<span class="count" title="Pendências">${pend}</span>` : ''}
            </button></li>`;
          }).join('') : '<li class="empty">Nenhum pet encontrado. Confira a grafia ou cadastre um novo pet.</li>'}
        </ul>
      </div>
      <div class="pet-ficha" id="pet-ficha">${state.petSel ? fichaPet(pet(state.petSel)) : ''}</div>
    </div>`;
}

function fichaPet(p) {
  if (!p) return '';
  const hoje = DateUtil.today();
  const proximos = db.agendamentos
    .filter(a => a.petId === p.id && a.data >= hoje && (a.status === 'agendado' || a.status === 'confirmado'))
    .sort((a, b) => (a.data + a.inicio).localeCompare(b.data + b.inicio));
  const hist = [...p.historico].sort((a, b) => b.data.localeCompare(a.data));
  const ult = ultimoBanho(p);
  const alertas = alertasAbertos(p.id);

  return `
    <div class="ficha-head">
      <span class="avatar lg">${esc(p.nome[0])}</span>
      <div>
        <h2>${esc(p.nome)}</h2>
        <p class="sub">${esc(p.especie)}, ${esc(p.raca || 'raça não informada')}, porte ${esc(p.porte.toLowerCase())}</p>
        <p class="tutor">Tutor: ${esc(p.tutor.nome)} <a href="${waLink(p.tutor.telefone, `Olá, ${p.tutor.nome.split(' ')[0]}! Aqui é da PetVida 🐾`)}" target="_blank" rel="noopener">WhatsApp</a></p>
      </div>
    </div>
    <div class="ficha-actions">
      <button class="btn primary sm" data-action="agendar-pet" data-pet="${p.id}" data-serv="consulta">Agendar consulta</button>
      <button class="btn ghost sm" data-action="agendar-pet" data-pet="${p.id}" data-serv="banho">Agendar banho</button>
    </div>

    ${alertas.length ? `<div class="notice warn"><strong>Observação da estética para o veterinário:</strong> ${alertas.map(x => `${esc(x.nota)} (${esc(x.por)}, ${DateUtil.short(x.data)})`).join('; ')}</div>` : ''}

    <div class="ficha-grid">
      <section class="panel">
        <h3>Vacinas</h3>
        ${p.vacinas.length ? `<div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>Vacina</th><th>Próxima</th><th>Situação</th></tr></thead>
          <tbody>${p.vacinas.map(v => {
            const st = statusVacina(v);
            return `<tr><td>${esc(v.nome)}</td><td>${DateUtil.short(v.proxima)}</td><td><span class="pill vac-${st.tipo}">${st.texto}</span></td></tr>`;
          }).join('')}</tbody></table></div>` : '<p class="empty">Nenhuma vacina registrada.</p>'}
      </section>
      <section class="panel">
        <h3>Estética</h3>
        <p>${p.cicloBanho ? `Banho a cada ${p.cicloBanho} dias.` : 'Sem ciclo de banho definido.'}</p>
        <p>${ult ? `Último banho em ${DateUtil.short(ult)} (há ${DateUtil.diffDays(ult, hoje)} dias).` : 'Ainda não tomou banho na PetVida.'}</p>
      </section>
      <section class="panel">
        <h3>Próximos agendamentos</h3>
        ${proximos.length ? `<ul class="mini">${proximos.map(a => `<li><span class="dot ${servico(a.servicoId).area}"></span>${DateUtil.short(a.data)} às ${a.inicio}, ${esc(servico(a.servicoId).nome.toLowerCase())} com ${esc(staff(a.staffId).curto)}</li>`).join('')}</ul>` : '<p class="empty">Nada agendado. Use os botões acima para marcar.</p>'}
      </section>
    </div>

    <section class="panel">
      <h3>Linha do tempo</h3>
      ${hist.length ? `<ol class="timeline">${hist.map(h => `
        <li class="area-${h.area}">
          <p class="tl-meta">${DateUtil.short(h.data)}, ${AREA_NOME[h.area].toLowerCase()}, ${esc(h.por)}</p>
          <p class="tl-title">${esc(h.titulo)}</p>
          <p>${esc(h.nota)}</p>
        </li>`).join('')}</ol>` : '<p class="empty">O histórico começa no primeiro atendimento concluído.</p>'}
    </section>`;
}

function salvarPet(e) {
  e.preventDefault();
  const f = e.target;
  const erro = $('#erro-pet');
  const tel = f.telefone.value.replace(/\D/g, '');
  if (!f.nome.value.trim() || !f.tutor.value.trim()) {
    erro.textContent = 'Preencha o nome do pet e do tutor.';
    erro.hidden = false; return;
  }
  if (tel.length < 10 || tel.length > 11) {
    erro.textContent = 'O WhatsApp precisa ter DDD + número (10 ou 11 dígitos).';
    erro.hidden = false; return;
  }
  const novo = {
    id: uid('p'), nome: f.nome.value.trim(), especie: f.especie.value, raca: f.raca.value.trim(),
    porte: f.porte.value, tutor: { nome: f.tutor.value.trim(), telefone: tel },
    cicloBanho: Number(f.ciclo.value) || 0, vacinas: [], historico: []
  };
  db.pets.push(novo);
  salvar();
  $('#dlg-pet').close();
  state.petSel = novo.id;
  state.busca = '';
  renderTudo();
  toast(`${novo.nome} cadastrado.`);
}

/* =========================================================
   VIEW: LEMBRETES
   ========================================================= */
function renderLembretes() {
  const el = $('#view-lembretes');
  const L = calcularLembretes();
  const nome1 = (p) => p.tutor.nome.split(' ')[0];

  const bloco = (titulo, desc, itens) => `
    <section class="panel">
      <h3>${titulo} <span class="count">${itens.length}</span></h3>
      <p class="sub">${desc}</p>
      ${itens.length ? `<ul class="rem-list">${itens.join('')}</ul>` : '<p class="empty">Tudo em dia por aqui.</p>'}
    </section>`;

  const confirmar = L.confirmar.map(a => {
    const p = pet(a.petId); const s = servico(a.servicoId);
    const msg = `Olá, ${nome1(p)}! Aqui é da PetVida 🐾 Confirmando ${s.nome.toLowerCase()} do(a) ${p.nome} amanhã (${DateUtil.short(a.data)}) às ${a.inicio}. Podemos confirmar?`;
    return `<li><div><strong>${esc(p.nome)}</strong> ${esc(s.nome.toLowerCase())} às ${a.inicio}<small>${esc(p.tutor.nome)}</small></div>
      <div class="rem-actions"><a class="btn ghost sm" href="${waLink(p.tutor.telefone, msg)}" target="_blank" rel="noopener">WhatsApp</a>
      <button class="btn primary sm" data-action="confirmar-ag" data-id="${a.id}">Marcar confirmado</button></div></li>`;
  });

  const vacinas = L.vacinas.map(({ p, v }) => {
    const msg = v.st.tipo === 'vencida'
      ? `Olá, ${nome1(p)}! A vacina ${v.nome} do(a) ${p.nome} venceu em ${DateUtil.short(v.proxima)}. Vamos agendar a aplicação? Se preferir, fazemos no mesmo dia do banho.`
      : `Olá, ${nome1(p)}! A vacina ${v.nome} do(a) ${p.nome} vence em ${DateUtil.short(v.proxima)}. Quer agendar? Se preferir, aplicamos no mesmo dia do banho.`;
    return `<li><div><strong>${esc(p.nome)}</strong> ${esc(v.nome)} <span class="pill vac-${v.st.tipo}">${v.st.texto}</span><small>${esc(p.tutor.nome)}</small></div>
      <div class="rem-actions"><a class="btn ghost sm" href="${waLink(p.tutor.telefone, msg)}" target="_blank" rel="noopener">WhatsApp</a>
      <button class="btn primary sm" data-action="agendar-pet" data-pet="${p.id}" data-serv="vacina">Agendar vacina</button></div></li>`;
  });

  const banhos = L.banhos.map(p => {
    const ult = ultimoBanho(p);
    const msg = `Olá, ${nome1(p)}! Já está chegando a hora do banho do(a) ${p.nome} 🛁 Temos horários livres esta semana. Quer agendar?`;
    return `<li><div><strong>${esc(p.nome)}</strong> banho a cada ${p.cicloBanho} dias<small>${ult ? `Último em ${DateUtil.short(ult)}` : 'Sem banho registrado'}</small></div>
      <div class="rem-actions"><a class="btn ghost sm" href="${waLink(p.tutor.telefone, msg)}" target="_blank" rel="noopener">WhatsApp</a>
      <button class="btn primary sm" data-action="agendar-pet" data-pet="${p.id}" data-serv="banho">Agendar banho</button></div></li>`;
  });

  const alertas = L.alertas.map(x => {
    const p = pet(x.petId);
    return `<li><div><strong>${esc(p.nome)}</strong> ${esc(x.nota)}<small>${esc(x.por)}, ${DateUtil.short(x.data)}</small></div>
      <div class="rem-actions"><button class="btn ghost sm" data-action="alerta-visto" data-id="${x.id}">Marcar como avaliado</button>
      <button class="btn primary sm" data-action="agendar-pet" data-pet="${p.id}" data-serv="consulta">Agendar consulta</button></div></li>`;
  });

  el.innerHTML = `
    <header class="view-head">
      <div>
        <h1 id="t-lembretes">Lembretes</h1>
        <p class="sub">Contatos para fazer hoje e evitar horários vazios</p>
      </div>
    </header>
    <div class="rem-grid">
      ${bloco('Confirmar amanhã', 'Agendamentos de amanhã que ainda não foram confirmados pelo tutor.', confirmar)}
      ${bloco('Vacinas', 'Vencidas ou vencendo nos próximos 30 dias.', vacinas)}
      ${bloco('Banhos no ciclo', 'Pets perto da data do próximo banho e sem horário marcado.', banhos)}
      ${bloco('Observações da estética', 'Pontos que os tosadores pediram para o veterinário avaliar.', alertas)}
    </div>`;
}

/* =========================================================
   VIEW: PAINEL
   ========================================================= */
function renderPainel() {
  const el = $('#view-painel');
  const data = state.data;
  const dia = doDia(data);
  const turno = HORARIO.fecha - HORARIO.abre;
  const receita = dia.reduce((t, a) => t + servico(a.servicoId).preco, 0);
  const banhos = dia.filter(a => servico(a.servicoId).area === 'estetica').length;
  const ocupTotal = dia.reduce((t, a) => t + a.duracao, 0) / (turno * db.equipe.length);
  const livres60 = db.equipe.filter(s => s.area === 'estetica')
    .flatMap(s => janelasLivres(s.id, data).filter(([i, f]) => f - i >= 60).map(j => ({ s, j })));
  const slotsLivres = db.equipe.reduce((t, s) =>
    t + janelasLivres(s.id, data).reduce((x, [i, f]) => x + Math.floor((f - i) / HORARIO.passo), 0), 0);

  el.innerHTML = `
    <header class="view-head">
      <div>
        <h1 id="t-painel">Painel do dia</h1>
        <p class="sub">${esc(DateUtil.label(data))}</p>
      </div>
      <div class="head-actions">
        <div class="day-nav" role="group" aria-label="Navegar entre dias">
          <button class="btn ghost sm" data-action="dia-ant" aria-label="Dia anterior">‹</button>
          <button class="btn ghost sm" data-action="dia-hoje">Hoje</button>
          <button class="btn ghost sm" data-action="dia-prox" aria-label="Próximo dia">›</button>
        </div>
      </div>
    </header>

    <div class="kpis">
      <div class="kpi"><p class="kpi-n">${dia.length}</p><p>atendimentos marcados</p></div>
      <div class="kpi"><p class="kpi-n">${brl(receita)}</p><p>receita prevista</p></div>
      <div class="kpi"><p class="kpi-n">${banhos}</p><p>banhos e tosas</p></div>
      <div class="kpi"><p class="kpi-n">${slotsLivres}</p><p>horários de 30 min livres</p></div>
    </div>

    <div class="painel-grid">
      <section class="panel">
        <h3>Ocupação por profissional</h3>
        <p class="sub">Equipe toda: ${Math.round(ocupTotal * 100)}% do turno ocupado.</p>
        <ul class="bars">
          ${db.equipe.map(s => {
            const min = dia.filter(a => a.staffId === s.id).reduce((t, a) => t + a.duracao, 0);
            const pct = Math.round(min / turno * 100);
            return `<li><span class="bar-label">${esc(s.curto)}</span>
              <span class="bar"><span class="bar-fill area-${s.area}" style="width:${pct}%"></span></span>
              <span class="bar-pct">${pct}%</span></li>`;
          }).join('')}
        </ul>
      </section>
      <section class="panel">
        <h3>Janelas livres na estética</h3>
        <p class="sub">Espaços de 1 hora ou mais. Use a aba Lembretes para chamar os pets no ciclo de banho.</p>
        ${livres60.length ? `<ul class="mini">${livres60.map(({ s, j }) => `
          <li><span class="dot estetica"></span>${esc(s.curto)}: ${DateUtil.toHHMM(j[0])} às ${DateUtil.toHHMM(j[1])}
          <button class="link" data-action="slot" data-staff="${s.id}" data-t="${DateUtil.toHHMM(j[0])}">Encaixar</button></li>`).join('')}</ul>`
          : '<p class="empty">Estética lotada neste dia.</p>'}
      </section>
    </div>`;
}

/* =========================================================
   Navegação e eventos
   ========================================================= */
function irPara(view) {
  state.view = view;
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('is-active', b.dataset.view === view));
  document.querySelectorAll('.view').forEach(v => { v.hidden = v.id !== `view-${view}`; });
  renderTudo();
  $('#main').scrollTop = 0;
}

function renderTudo() {
  const r = { agenda: renderAgenda, pets: renderPets, lembretes: renderLembretes, painel: renderPainel };
  try {
    r[state.view]();
    atualizarBadge();
  } catch (err) {
    console.error(err);
    $(`#view-${state.view}`).innerHTML = `
      <div class="panel">
        <h3>Não foi possível carregar esta tela</h3>
        <p>Os dados salvos neste navegador podem estar desatualizados. Clique em <strong>Restaurar demonstração</strong> no menu.</p>
        <p class="sub">Detalhe técnico: ${esc(err.message)}</p>
      </div>`;
  }
}

document.addEventListener('click', (e) => {
  const closeBtn = e.target.closest('[data-close]');
  if (closeBtn) { closeBtn.closest('dialog').close(); return; }

  const nav = e.target.closest('.nav-btn');
  if (nav) { irPara(nav.dataset.view); return; }

  const el = e.target.closest('[data-action]');
  if (!el) return;
  const act = el.dataset.action;

  switch (act) {
    case 'dia-ant': state.data = DateUtil.addDays(state.data, -1); renderTudo(); break;
    case 'dia-prox': state.data = DateUtil.addDays(state.data, 1); renderTudo(); break;
    case 'dia-hoje': state.data = DateUtil.today(); renderTudo(); break;
    case 'filtro': state.filtro = el.dataset.f; renderAgenda(); break;
    case 'novo-ag': abrirAgendar(); break;
    case 'slot': abrirAgendar({ staffId: el.dataset.staff, inicio: el.dataset.t, data: state.data }); break;
    case 'abrir-ag': abrirDetalhe(el.dataset.id); break;
    case 'status': mudarStatus(el.dataset.st); break;
    case 'concluir': abrirConcluir(); break;
    case 'ver-ficha':
      $('#dlg-detalhe').close();
      state.petSel = el.dataset.pet; state.busca = '';
      irPara('pets'); break;
    case 'sel-pet': state.petSel = el.dataset.pet; renderPets(); break;
    case 'novo-pet':
      $('#form-pet').reset(); $('#erro-pet').hidden = true; $('#dlg-pet').showModal(); break;
    case 'agendar-pet':
      abrirAgendar({ petId: el.dataset.pet, servicoId: el.dataset.serv, data: DateUtil.today() }); break;
    case 'confirmar-ag': {
      const a = db.agendamentos.find(x => x.id === el.dataset.id);
      a.status = 'confirmado'; salvar(); renderTudo();
      toast(`${pet(a.petId).nome} confirmado.`); break;
    }
    case 'alerta-visto': {
      const x = db.alertas.find(y => y.id === el.dataset.id);
      x.visto = true; salvar(); renderTudo(); toast('Observação marcada como avaliada.'); break;
    }
  }
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'busca-pet') {
    state.busca = e.target.value;
    const pos = e.target.selectionStart;
    renderPets();
    const inp = $('#busca-pet');
    inp.focus();
    inp.setSelectionRange(pos, pos);
  }
});

$('#form-agendar').addEventListener('change', (e) => {
  if (e.target.name === 'servicoId') atualizarProfissionais();
  if (e.target.name === 'servicoId' || e.target.name === 'petId') atualizarAvisoSaude();
  $('#erro-agendar').hidden = true;
});
$('#form-agendar').addEventListener('submit', salvarAgendamento);
$('#form-concluir').addEventListener('submit', concluir);
$('#form-pet').addEventListener('submit', salvarPet);

$('#btn-reset').addEventListener('click', () => {
  if (confirm('Restaurar os dados de demonstração? As alterações feitas neste navegador serão apagadas.')) {
    db = Store.reset();
    state.data = DateUtil.today();
    state.petSel = null;
    renderTudo();
    toast('Dados de demonstração restaurados.');
  }
});

irPara('agenda');
