"use strict";

const STORAGE_KEY = "balance-pwa-data-v1";
const CURRENCIES = ["EUR", "USD", "RUB", "GBP", "TRY"];
const $ = selector => document.querySelector(selector);
const content = $("#content");
const title = $("#page-title");
const eyebrow = $("#eyebrow");
const action = $("#page-action");
const modal = $("#modal");
const modalForm = $("#modal-form");
const modalBody = $("#modal-body");

let view = "overview";
let debtDirection = "owedToMe";
let showSettled = false;
let showCompleted = false;
let expenseMonth = monthKey(new Date());
let calendarMonth = expenseMonth;
let selectedDay = dateKey(new Date());
let state = loadState();

function emptyState() {
  return { version: 2, debts: [], expenses: [], templates: [], incomes: [], tasks: [], savings: {} };
}

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    const loaded = { ...emptyState(), ...(parsed || {}) };
    loaded.savings ||= {};
    return loaded;
  } catch { return emptyState(); }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function esc(value = "") {
  return String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function localDate(value) {
  if (value instanceof Date) return value;
  const [date, time = "00:00"] = String(value).split("T");
  const [y, m, d] = date.split("-").map(Number);
  const [h, min] = time.split(":").map(Number);
  return new Date(y, m - 1, d || 1, h || 0, min || 0);
}

function dateKey(date) {
  const d = localDate(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function monthKey(date) { return dateKey(date).slice(0, 7); }
function monthDate(key) { return localDate(`${key}-01`); }
function shiftMonth(key, amount) { const d = monthDate(key); d.setMonth(d.getMonth() + amount); return monthKey(d); }
function monthLabel(key) { return new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(monthDate(key)); }
function dayLabel(key) { return new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long" }).format(localDate(key)); }
function shortDate(key) { return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(localDate(key)); }
function dateTimeLabel(value) { return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(localDate(value)); }

function money(amount, currency) {
  try { return new Intl.NumberFormat("ru-RU", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(amount) || 0); }
  catch { return `${Number(amount || 0).toFixed(2)} ${currency}`; }
}

function currenciesOptions(selected = "EUR") {
  return CURRENCIES.map(c => `<option value="${c}" ${c === selected ? "selected" : ""}>${c}</option>`).join("");
}

function totals(items, amountKey = "amount") {
  return items.reduce((result, item) => {
    result[item.currency] = (result[item.currency] || 0) + Number(item[amountKey] || 0);
    return result;
  }, {});
}

function compactTotals(items) {
  const grouped = totals(items);
  const values = Object.keys(grouped).sort().map(currency => money(grouped[currency], currency));
  return values.length ? values.join(" · ") : "—";
}

function ensureRecurring(key) {
  let changed = false;
  state.templates.filter(t => t.active !== false && t.startMonth <= key).forEach(template => {
    if (!state.expenses.some(e => e.templateId === template.id && e.month === key)) {
      state.expenses.push({ id: uid(), title: template.title, amount: template.amount, currency: template.currency, month: key, date: null, note: template.note || "", completed: false, templateId: template.id });
      changed = true;
    }
  });
  if (changed) saveState();
}

function monthStats(key) {
  ensureRecurring(key);
  const expenses = state.expenses.filter(e => e.month === key);
  const incomes = state.incomes.filter(i => i.month === key);
  const codes = [...new Set([...expenses.map(e => e.currency), ...incomes.map(i => i.currency)])].sort();
  return codes.map(currency => ({
    currency,
    income: incomes.filter(i => i.currency === currency).reduce((n, i) => n + Number(i.amount), 0),
    planned: expenses.filter(e => e.currency === currency).reduce((n, e) => n + Number(e.amount), 0),
    paid: expenses.filter(e => e.currency === currency && e.completed).reduce((n, e) => n + Number(e.amount), 0)
  }));
}

function savingsStats() {
  const current = monthKey(new Date());
  const codes = Object.keys(state.savings || {}).sort();
  return codes.map(currency => {
    const saved = state.savings[currency];
    const initial = Number(typeof saved === "object" ? saved.amount : saved || 0);
    const startMonth = typeof saved === "object" ? saved.startMonth : "0000-00";
    const fromMonths = state.incomes.filter(i => i.currency === currency && i.month >= startMonth && i.month < current).reduce((sum, i) => sum + Number(i.amount), 0)
      - state.expenses.filter(e => e.currency === currency && e.completed && e.month >= startMonth && e.month < current).reduce((sum, e) => sum + Number(e.amount), 0);
    return { currency, initial, fromMonths, total: initial + fromMonths };
  });
}

function setHeader(name, sub = "", hasAction = false) {
  title.textContent = name;
  eyebrow.textContent = sub;
  action.classList.toggle("hidden", !hasAction);
}

function empty(icon, heading, text) {
  return `<div class="empty"><div style="font-size:28px;margin-bottom:8px">${icon}</div><b>${heading}</b><span>${text}</span></div>`;
}

function metricsHtml(stats, closed = false) {
  if (!stats.length) return empty("◎", "Пока нет данных", "Добавьте поступление или платёж");
  return stats.map(stat => {
    const balance = stat.income - (closed ? stat.paid : stat.planned);
    const label = balance < 0 ? "Убыток" : (closed ? "Сэкономлено" : "Экономия по плану");
    return `<div class="currency-block">
      <div class="currency-head"><b>${stat.currency}</b><span>Доход ${money(stat.income, stat.currency)}</span></div>
      <div class="metrics">
        <div class="metric"><span>План платежей</span><strong>${money(stat.planned, stat.currency)}</strong></div>
        <div class="metric accent"><span>Уже оплачено</span><strong>${money(stat.paid, stat.currency)}</strong></div>
        <div class="metric ${balance < 0 ? "negative" : "positive"}"><span>${label}</span><strong>${money(Math.abs(balance), stat.currency)}</strong></div>
      </div>
    </div>`;
  }).join("");
}

function renderOverview() {
  setHeader("Balance");
  const current = monthKey(new Date());
  const active = state.debts.filter(d => !d.settled);
  const mine = active.filter(d => d.direction === "owedToMe");
  const owed = active.filter(d => d.direction === "iOwe");
  const today = dateKey(new Date());
  const upcoming = [
    ...active.filter(d => d.dueDate && d.dueDate >= today).map(d => ({ type: "debt", date: d.dueDate, data: d })),
    ...state.tasks.filter(t => !t.completed && t.date.slice(0, 10) >= today).map(t => ({ type: "task", date: t.date, data: t }))
  ].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 7);
  const savings = savingsStats();
  content.innerHTML = `<div class="stack">
    <div class="hero"><p>${new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long" }).format(new Date())}</p><h2>Всё важное — в одном месте</h2></div>
    <section class="section"><div class="section-head"><h2>Долги</h2></div><div class="summary-grid">
      <div class="summary green"><div class="bubble">↙</div><strong>${esc(compactTotals(mine))}</strong><small>Мне должны</small></div>
      <div class="summary red"><div class="bubble">↗</div><strong>${esc(compactTotals(owed))}</strong><small>Я должен</small></div>
    </div></section>
    <section class="section"><div class="section-head"><h2>Копилка</h2><button class="text-button" id="edit-savings">Изменить</button></div><div class="savings-card">
      <img class="pig-image" src="icons/piggy-inline.png" alt="" aria-hidden="true">
      <div class="savings-values">${savings.length ? savings.map(item => `<div class="saving-line"><div><strong>${money(item.total, item.currency)}</strong><small>${item.fromMonths >= 0 ? "+" : "−"}${money(Math.abs(item.fromMonths), item.currency)} из закрытых месяцев</small></div><b>${item.currency}</b></div>`).join("") : `<div><strong>Копилка пуста</strong><small>Укажите сумму, которая уже накоплена</small></div>`}</div>
    </div><p class="caption">Остаток закрытого месяца добавляется автоматически: поступления минус оплаченные расходы.</p></section>
    <section class="section"><div class="section-head"><h2>Текущий месяц</h2><span>${monthLabel(current)}</span></div><div class="card card-pad">${metricsHtml(monthStats(current))}</div></section>
    <section class="section"><div class="section-head"><h2>Ближайшее</h2></div><div class="card">${upcoming.length ? upcoming.map(item => upcomingRow(item)).join("") : empty("✓", "Всё спокойно", "Пока ничего не запланировано")}</div></section>
    <section class="section"><div class="section-head"><h2>Резервная копия</h2></div><div class="add-menu"><button class="soft-button" id="export-data">Сохранить данные</button><button class="soft-button" id="import-data">Восстановить</button><input class="hidden" id="import-file" type="file" accept="application/json,.json"></div><p class="caption">Записи хранятся только на этом устройстве. Иногда сохраняйте копию в «Файлы».</p></section>
  </div>`;
  $("#edit-savings").onclick = openSavingsForm;
  $("#export-data").onclick = exportData;
  $("#import-data").onclick = () => $("#import-file").click();
  $("#import-file").onchange = importData;
}

function openSavingsForm() {
  const rows = CURRENCIES.map(currency => { const saved = state.savings?.[currency]; const amount = typeof saved === "object" ? saved.amount : saved; return `<div class="field"><label>${currency}</label><input name="saving-${currency}" type="number" step="0.01" inputmode="decimal" value="${Number(amount || 0)}"></div>`; }).join("");
  openModal("Сумма в копилке", `<div class="form-card">${rows}</div><p class="form-note">Введите сумму, которая уже накоплена. Начиная с текущего месяца остатки закрытых месяцев будут прибавляться автоматически и отдельно для каждой валюты.</p>`, data => {
    const next = {};
    CURRENCIES.forEach(currency => {
      const amount = Number(data.get(`saving-${currency}`) || 0);
      const previous = state.savings?.[currency];
      if (amount !== 0 || previous !== undefined) next[currency] = { amount, startMonth: (typeof previous === "object" && previous.startMonth) || monthKey(new Date()) };
    });
    state.savings = next;
  });
}

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `balance-${dateKey(new Date())}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

async function importData(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.debts) || !Array.isArray(data.expenses) || !Array.isArray(data.tasks)) throw new Error("bad format");
    if (!confirm("Заменить текущие записи данными из резервной копии?")) return;
    state = { ...emptyState(), ...data, savings: data.savings || {} };
    saveState(); render(); toast("Данные восстановлены");
  } catch { toast("Не удалось прочитать резервную копию"); }
  event.target.value = "";
}

function toast(message) {
  const element = $("#toast"); element.textContent = message; element.classList.add("show");
  setTimeout(() => element.classList.remove("show"), 2200);
}

function upcomingRow(item) {
  if (item.type === "debt") {
    const d = item.data;
    return `<div class="row"><span class="dot-icon ${d.direction === "owedToMe" ? "green" : "red"}">↔</span><div class="row-main"><div class="row-title">${esc(d.person)}</div><div class="row-sub">${shortDate(d.dueDate)}</div></div><div class="row-value">${money(d.amount, d.currency)}</div></div>`;
  }
  const t = item.data;
  return `<div class="row"><span class="dot-icon ${t.important ? "red" : ""}">${t.important ? "!" : "✓"}</span><div class="row-main"><div class="row-title">${esc(t.title)}</div><div class="row-sub">${dateTimeLabel(t.date)}</div></div></div>`;
}

function renderDebts() {
  setHeader("Долги", "Нажмите на запись, чтобы изменить", true);
  const items = state.debts.filter(d => d.direction === debtDirection && (showSettled || !d.settled));
  const activeItems = items.filter(d => !d.settled);
  content.innerHTML = `<div class="stack">
    <div class="segmented"><button data-direction="owedToMe" class="${debtDirection === "owedToMe" ? "active" : ""}">Мне должны</button><button data-direction="iOwe" class="${debtDirection === "iOwe" ? "active" : ""}">Я должен</button></div>
    <section class="section"><div class="section-head"><h2>Итого</h2><button class="text-button" id="toggle-debt-history">${showSettled ? "Только активные" : "История"}</button></div><div class="card card-pad">${Object.entries(totals(activeItems)).map(([c, amount]) => `<div class="metric"><span>${c}</span><strong>${money(amount, c)}</strong></div>`).join("") || `<span class="caption">Активных долгов нет</span>`}</div></section>
    <section class="section"><div class="card">${items.length ? items.map(debtRow).join("") : empty("↔", "Долгов нет", "Добавьте первую запись кнопкой +")}</div></section>
  </div>`;
  content.querySelectorAll("[data-direction]").forEach(b => b.onclick = () => { debtDirection = b.dataset.direction; render(); });
  $("#toggle-debt-history").onclick = () => { showSettled = !showSettled; render(); };
  content.querySelectorAll("[data-debt-edit]").forEach(row => row.onclick = event => { if (!event.target.closest("button")) openDebtForm(row.dataset.debtEdit); });
  content.querySelectorAll("[data-debt-check]").forEach(b => b.onclick = () => { const d = state.debts.find(x => x.id === b.dataset.debtCheck); d.settled = !d.settled; saveState(); render(); });
}

function debtRow(d) {
  return `<div class="row clickable" data-debt-edit="${d.id}"><button class="check ${d.settled ? "done" : ""}" data-debt-check="${d.id}" aria-label="Погашено">${d.settled ? "✓" : ""}</button><span class="dot-icon">●</span><div class="row-main"><div class="row-title ${d.settled ? "done-text" : ""}">${esc(d.person)}</div><div class="row-sub">${d.dueDate ? `До ${shortDate(d.dueDate)}` : (d.note ? esc(d.note) : "Без срока")}</div></div><div class="row-value ${d.settled ? "done-text" : ""}">${money(d.amount, d.currency)}</div><button class="row-action" aria-label="Изменить">›</button></div>`;
}

function renderExpenses() {
  ensureRecurring(expenseMonth);
  setHeader("Расходы", "Планирование по месяцам", false);
  const items = state.expenses.filter(e => e.month === expenseMonth).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const incomes = state.incomes.filter(i => i.month === expenseMonth);
  const closed = expenseMonth < monthKey(new Date());
  content.innerHTML = `<div class="stack">
    <div class="card month-nav"><button data-month="-1">‹</button><strong>${monthLabel(expenseMonth)}</strong><button data-month="1">›</button></div>
    <div class="add-menu"><button class="soft-button" id="add-expense">＋ Платёж</button><button class="soft-button" id="add-income">＋ Поступление</button></div>
    <section class="section"><div class="section-head"><h2>${closed ? "Итог месяца" : "Статистика месяца"}</h2></div><div class="card card-pad">${metricsHtml(monthStats(expenseMonth), closed)}</div></section>
    <section class="section"><div class="section-head"><h2>Поступления</h2></div><div class="card">${incomes.length ? incomes.map(incomeRow).join("") : empty("↓", "Поступлений нет", "Укажите доход за выбранный месяц")}</div></section>
    <section class="section"><div class="section-head"><h2>Платежи месяца</h2></div><div class="card">${items.length ? items.map(expenseRow).join("") : empty("▰", "Платежей нет", "Добавьте разовый или ежемесячный платёж")}</div></section>
  </div>`;
  content.querySelectorAll("[data-month]").forEach(b => b.onclick = () => { expenseMonth = shiftMonth(expenseMonth, Number(b.dataset.month)); render(); });
  $("#add-expense").onclick = () => openExpenseForm();
  $("#add-income").onclick = () => openIncomeForm();
  content.querySelectorAll("[data-expense-check]").forEach(b => b.onclick = () => { const e = state.expenses.find(x => x.id === b.dataset.expenseCheck); e.completed = !e.completed; saveState(); render(); });
  content.querySelectorAll("[data-expense-delete]").forEach(b => b.onclick = () => deleteExpense(b.dataset.expenseDelete));
  content.querySelectorAll("[data-income-edit]").forEach(row => row.onclick = event => { if (!event.target.closest("button")) openIncomeForm(row.dataset.incomeEdit); });
  content.querySelectorAll("[data-income-delete]").forEach(b => b.onclick = () => { state.incomes = state.incomes.filter(i => i.id !== b.dataset.incomeDelete); saveState(); render(); });
}

function incomeRow(i) {
  return `<div class="row clickable" data-income-edit="${i.id}"><span class="dot-icon green">↓</span><div class="row-main"><div class="row-title">Поступления</div><div class="row-sub">Нажмите, чтобы изменить</div></div><div class="row-value">${money(i.amount, i.currency)}</div><button class="row-action" data-income-delete="${i.id}" aria-label="Удалить">×</button></div>`;
}

function expenseRow(e) {
  return `<div class="row"><button class="check ${e.completed ? "done" : ""}" data-expense-check="${e.id}" aria-label="Оплачено">${e.completed ? "✓" : ""}</button><div class="row-main"><div class="row-title ${e.completed ? "done-text" : ""}">${esc(e.title)}</div><div class="row-sub">${e.templateId ? "Ежемесячный платёж" : (e.date ? shortDate(e.date) : "Разовый платёж")}</div></div><div class="row-value ${e.completed ? "done-text" : ""}">${money(e.amount, e.currency)}</div><button class="row-action" data-expense-delete="${e.id}" aria-label="Удалить">×</button></div>`;
}

function deleteExpense(id) {
  const expense = state.expenses.find(e => e.id === id);
  if (!expense) return;
  if (expense.templateId && confirm("Удалить этот ежемесячный платёж из выбранного и всех следующих месяцев?")) {
    state.templates = state.templates.filter(t => t.id !== expense.templateId);
    state.expenses = state.expenses.filter(e => e.templateId !== expense.templateId || e.month < expenseMonth || e.completed);
  } else if (!expense.templateId && confirm("Удалить этот платёж?")) {
    state.expenses = state.expenses.filter(e => e.id !== id);
  } else return;
  saveState(); render();
}

function calendarEvents(key) {
  return {
    tasks: state.tasks.filter(t => t.date.slice(0, 10) === key),
    expenses: state.expenses.filter(e => !e.templateId && e.date === key),
    debts: state.debts.filter(d => d.dueDate === key)
  };
}

function renderCalendar() {
  ensureRecurring(calendarMonth);
  setHeader("Календарь", "События и платежи");
  const first = monthDate(calendarMonth);
  const daysCount = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const leading = (first.getDay() + 6) % 7;
  let cells = "<div></div>".repeat(leading);
  for (let day = 1; day <= daysCount; day++) {
    const key = `${calendarMonth}-${String(day).padStart(2, "0")}`;
    const events = calendarEvents(key);
    const markers = `${events.tasks.length ? "<i></i>" : ""}${events.expenses.length ? '<i class="expense"></i>' : ""}${events.debts.length ? '<i class="debt"></i>' : ""}`;
    cells += `<button class="day ${key === selectedDay ? "selected" : ""} ${key === dateKey(new Date()) ? "today" : ""}" data-day="${key}"><b>${day}</b><span class="markers">${markers}</span></button>`;
  }
  const events = calendarEvents(selectedDay);
  const rows = [
    ...events.tasks.map(t => `<div class="row"><span class="dot-icon ${t.important ? "red" : ""}">${t.important ? "!" : "✓"}</span><div class="row-main"><div class="row-title">${esc(t.title)}</div><div class="row-sub">${localDate(t.date).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</div></div></div>`),
    ...events.expenses.map(e => `<div class="row"><span class="dot-icon">▰</span><div class="row-main"><div class="row-title">${esc(e.title)}</div><div class="row-sub">${money(e.amount, e.currency)}</div></div></div>`),
    ...events.debts.map(d => `<div class="row"><span class="dot-icon ${d.direction === "owedToMe" ? "green" : "red"}">↔</span><div class="row-main"><div class="row-title">${esc(d.person)}</div><div class="row-sub">${money(d.amount, d.currency)}</div></div></div>`)
  ];
  content.innerHTML = `<div class="stack"><div class="card month-nav"><button data-cal-month="-1">‹</button><strong>${monthLabel(calendarMonth)}</strong><button data-cal-month="1">›</button></div><div><div class="weekdays">${["ПН","ВТ","СР","ЧТ","ПТ","СБ","ВС"].map(x => `<div>${x}</div>`).join("")}</div><div class="calendar-grid">${cells}</div></div><section class="section"><div class="section-head"><h2>${dayLabel(selectedDay)}</h2></div><div class="card">${rows.length ? rows.join("") : empty("○", "Свободный день", "На этот день ничего не запланировано")}</div></section></div>`;
  content.querySelectorAll("[data-cal-month]").forEach(b => b.onclick = () => { calendarMonth = shiftMonth(calendarMonth, Number(b.dataset.calMonth)); selectedDay = `${calendarMonth}-01`; render(); });
  content.querySelectorAll("[data-day]").forEach(b => b.onclick = () => { selectedDay = b.dataset.day; render(); });
}

function renderTasks() {
  setHeader("Дела", showCompleted ? "Выполненные и активные" : "Предстоящие", true);
  const items = state.tasks.filter(t => showCompleted || !t.completed).sort((a, b) => a.date.localeCompare(b.date));
  const groups = items.reduce((result, task) => { const day = task.date.slice(0, 10); (result[day] ||= []).push(task); return result; }, {});
  content.innerHTML = `<div class="stack"><div style="text-align:right"><button class="text-button" id="toggle-task-history">${showCompleted ? "Только активные" : "История"}</button></div>${Object.keys(groups).length ? Object.entries(groups).map(([day, tasks]) => `<section class="section"><div class="section-head"><h2>${dayLabel(day)}</h2></div><div class="card">${tasks.map(taskRow).join("")}</div></section>`).join("") : `<div class="card">${empty("✓", "Дел нет", "Добавьте важное дело и назначьте дату")}</div>`}</div>`;
  $("#toggle-task-history").onclick = () => { showCompleted = !showCompleted; render(); };
  content.querySelectorAll("[data-task-check]").forEach(b => b.onclick = () => { const t = state.tasks.find(x => x.id === b.dataset.taskCheck); t.completed = !t.completed; saveState(); render(); });
  content.querySelectorAll("[data-task-delete]").forEach(b => b.onclick = () => { if (confirm("Удалить это дело?")) { state.tasks = state.tasks.filter(t => t.id !== b.dataset.taskDelete); saveState(); render(); } });
}

function taskRow(t) {
  return `<div class="row"><button class="check ${t.completed ? "done" : ""}" data-task-check="${t.id}">${t.completed ? "✓" : ""}</button><div class="row-main"><div class="row-title ${t.completed ? "done-text" : ""}">${esc(t.title)} ${t.important ? '<span class="negative">!</span>' : ""}</div><div class="row-sub">${localDate(t.date).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}${t.note ? ` · ${esc(t.note)}` : ""}</div></div><button class="row-action" data-task-delete="${t.id}">×</button></div>`;
}

function openModal(name, body, onSave) {
  $("#modal-title").textContent = name;
  modalBody.innerHTML = body;
  modalForm.onsubmit = event => {
    if (event.submitter?.value === "cancel") return;
    event.preventDefault();
    const data = new FormData(modalForm);
    if (onSave(data) !== false) { saveState(); modal.close(); render(); }
  };
  modal.showModal();
}

function openDebtForm(id = null) {
  const debt = state.debts.find(d => d.id === id);
  const d = debt || { person: "", amount: "", currency: "EUR", direction: debtDirection, dueDate: "", note: "" };
  openModal(debt ? "Изменить долг" : "Новый долг", `<div class="form-card">
    <div class="field"><label>Тип</label><select name="direction"><option value="owedToMe" ${d.direction === "owedToMe" ? "selected" : ""}>Мне должны</option><option value="iOwe" ${d.direction === "iOwe" ? "selected" : ""}>Я должен</option></select></div>
    <div class="field"><label>Имя</label><input name="person" value="${esc(d.person)}" placeholder="Сергей" required></div>
    <div class="field"><label>Сумма</label><input name="amount" value="${d.amount}" type="number" min="0.01" step="0.01" inputmode="decimal" required></div>
    <div class="field"><label>Валюта</label><select name="currency">${currenciesOptions(d.currency)}</select></div>
    <div class="field"><label>Срок</label><input name="dueDate" value="${d.dueDate || ""}" type="date"></div>
    <div class="field"><label>Комментарий</label><textarea name="note" placeholder="Необязательно">${esc(d.note)}</textarea></div>
  </div>${debt ? '<div class="form-actions"><button type="button" class="soft-button danger-button" id="delete-current">Удалить долг</button></div>' : ""}`, data => {
    const values = Object.fromEntries(data);
    const record = { id: debt?.id || uid(), person: values.person.trim(), amount: Number(values.amount), currency: values.currency, direction: values.direction, dueDate: values.dueDate || null, note: values.note.trim(), settled: debt?.settled || false, createdAt: debt?.createdAt || Date.now() };
    if (!record.person || record.amount <= 0) return false;
    if (debt) Object.assign(debt, record); else state.debts.push(record);
  });
  const del = $("#delete-current");
  if (del) del.onclick = () => { if (confirm("Удалить этот долг?")) { state.debts = state.debts.filter(x => x.id !== debt.id); saveState(); modal.close(); render(); } };
}

function openExpenseForm() {
  const monthStart = `${expenseMonth}-01`;
  const lastDay = dateKey(new Date(monthDate(expenseMonth).getFullYear(), monthDate(expenseMonth).getMonth() + 1, 0));
  openModal("Новый расход", `<div class="segmented"><button type="button" class="active" data-kind="once">Разовый</button><button type="button" data-kind="monthly">Ежемесячный</button></div><input type="hidden" name="kind" value="once"><div class="form-card">
    <div class="field"><label>Название</label><input name="title" placeholder="Аренда" required></div>
    <div class="field"><label>Сумма</label><input name="amount" type="number" min="0.01" step="0.01" inputmode="decimal" required></div>
    <div class="field"><label>Валюта</label><select name="currency">${currenciesOptions()}</select></div>
    <div class="field" id="expense-date-row"><label>Дата</label><input name="date" type="date" value="${monthStart}" min="${monthStart}" max="${lastDay}"></div>
    <div class="field"><label>Комментарий</label><textarea name="note" placeholder="Необязательно"></textarea></div>
  </div><p class="form-note" id="recurring-note"></p>`, data => {
    const v = Object.fromEntries(data); const base = { title: v.title.trim(), amount: Number(v.amount), currency: v.currency, note: v.note.trim() };
    if (!base.title || base.amount <= 0) return false;
    if (v.kind === "monthly") { const template = { ...base, id: uid(), startMonth: expenseMonth, active: true }; state.templates.push(template); state.expenses.push({ ...base, id: uid(), month: expenseMonth, date: null, completed: false, templateId: template.id }); }
    else state.expenses.push({ ...base, id: uid(), month: expenseMonth, date: v.date || monthStart, completed: false, templateId: null });
  });
  modalBody.querySelectorAll("[data-kind]").forEach(button => button.onclick = () => {
    modalBody.querySelectorAll("[data-kind]").forEach(x => x.classList.toggle("active", x === button));
    modalForm.elements.kind.value = button.dataset.kind;
    $("#expense-date-row").classList.toggle("hidden", button.dataset.kind === "monthly");
    $("#recurring-note").textContent = button.dataset.kind === "monthly" ? `Платёж появится в ${monthLabel(expenseMonth)} и во всех следующих месяцах без конкретной даты.` : "";
  });
}

function openIncomeForm(id = null) {
  const income = state.incomes.find(i => i.id === id);
  openModal(income ? "Изменить поступление" : "Поступление", `<div class="form-card"><div class="field"><label>Месяц</label><strong style="text-align:right">${monthLabel(expenseMonth)}</strong></div><div class="field"><label>Сумма</label><input name="amount" type="number" min="0" step="0.01" inputmode="decimal" value="${income?.amount ?? ""}" required></div><div class="field"><label>Валюта</label><select name="currency">${currenciesOptions(income?.currency || "EUR")}</select></div></div><p class="form-note">Для каждой валюты хранится одно итоговое поступление за месяц. Повторное сохранение обновит сумму.</p>`, data => {
    const v = Object.fromEntries(data); const amount = Number(v.amount);
    if (amount < 0) return false;
    const existing = income || state.incomes.find(i => i.month === expenseMonth && i.currency === v.currency);
    if (existing) Object.assign(existing, { amount, currency: v.currency }); else state.incomes.push({ id: uid(), month: expenseMonth, amount, currency: v.currency });
  });
}

function openTaskForm() {
  const now = new Date(); now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  openModal("Новое дело", `<div class="form-card"><div class="field"><label>Название</label><input name="title" placeholder="Что нужно сделать?" required></div><div class="field"><label>Дата и время</label><input name="date" type="datetime-local" value="${now.toISOString().slice(0,16)}" required></div><div class="field"><label>Важное</label><input name="important" type="checkbox" value="yes" style="width:22px;justify-self:end"></div><div class="field"><label>Комментарий</label><textarea name="note" placeholder="Необязательно"></textarea></div></div>`, data => {
    const v = Object.fromEntries(data); if (!v.title.trim()) return false;
    state.tasks.push({ id: uid(), title: v.title.trim(), date: v.date, important: v.important === "yes", note: v.note.trim(), completed: false, createdAt: Date.now() });
  });
}

function render() {
  document.querySelectorAll(".tab").forEach(tab => tab.classList.toggle("active", tab.dataset.tab === view));
  ({ overview: renderOverview, debts: renderDebts, expenses: renderExpenses, calendar: renderCalendar, tasks: renderTasks }[view])();
  window.scrollTo({ top: 0 });
}

document.querySelectorAll(".tab").forEach(tab => tab.onclick = () => { view = tab.dataset.tab; render(); });
action.onclick = () => { if (view === "debts") openDebtForm(); if (view === "tasks") openTaskForm(); };

window.addEventListener("storage", () => { state = loadState(); render(); });
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js"));
if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
render();
