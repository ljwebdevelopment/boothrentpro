import { auth, db } from './firebase-config.js';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  where
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const els = {
  ownerLoginCard: document.getElementById('ownerLoginCard'),
  ownerLoginForm: document.getElementById('ownerLoginForm'),
  ownerEmail: document.getElementById('ownerEmail'),
  ownerPassword: document.getElementById('ownerPassword'),
  logoutBtn: document.getElementById('logoutBtn'),
  authEmail: document.getElementById('authEmail'),
  dashboard: document.getElementById('dashboard'),
  shopTitle: document.getElementById('shopTitle'),
  weekLabel: document.getElementById('weekLabel'),
  searchInput: document.getElementById('searchInput'),
  statusFilter: document.getElementById('statusFilter'),
  addEmployeeForm: document.getElementById('addEmployeeForm'),
  addEmployeeBtn: document.getElementById('addEmployeeBtn'),
  employeeList: document.getElementById('employeeList'),

  summaryTotalDue: document.getElementById('summaryTotalDue'),
  summaryTotalReceived: document.getElementById('summaryTotalReceived'),
  summaryPastDue: document.getElementById('summaryPastDue'),
  summaryReminded: document.getElementById('summaryReminded'),

  drawer: document.getElementById('drawer'),
  drawerTitle: document.getElementById('drawerTitle'),
  drawerContent: document.getElementById('drawerContent'),
  closeDrawerBtn: document.getElementById('closeDrawerBtn'),

  paymentModalBackdrop: document.getElementById('paymentModalBackdrop'),
  paymentForm: document.getElementById('paymentForm'),
  closePaymentModalBtn: document.getElementById('closePaymentModalBtn'),
  cancelPaymentBtn: document.getElementById('cancelPaymentBtn'),
  savePaymentBtn: document.getElementById('savePaymentBtn'),
  paymentAmount: document.getElementById('paymentAmount'),
  paymentMethod: document.getElementById('paymentMethod'),
  paymentPaidAt: document.getElementById('paymentPaidAt'),
  paymentNotes: document.getElementById('paymentNotes'),
  paymentAmountError: document.getElementById('paymentAmountError'),

  confirmModalBackdrop: document.getElementById('confirmModalBackdrop'),
  confirmMessage: document.getElementById('confirmMessage'),
  confirmActionBtn: document.getElementById('confirmActionBtn'),
  cancelConfirmBtn: document.getElementById('cancelConfirmBtn'),

  emailModalBackdrop: document.getElementById('emailModalBackdrop'),
  closeEmailModalBtn: document.getElementById('closeEmailModalBtn'),
  cancelEmailBtn: document.getElementById('cancelEmailBtn'),
  emailToInput: document.getElementById('emailToInput'),
  emailSubjectInput: document.getElementById('emailSubjectInput'),
  emailBodyInput: document.getElementById('emailBodyInput'),
  copyEmailBtn: document.getElementById('copyEmailBtn'),
  openMailAppBtn: document.getElementById('openMailAppBtn'),
  openGmailBtn: document.getElementById('openGmailBtn'),
  copySubjectBtn: document.getElementById('copySubjectBtn'),
  copyBodyBtn: document.getElementById('copyBodyBtn'),
  emailLongBodyWarning: document.getElementById('emailLongBodyWarning'),
  receiptSummaryCard: document.getElementById('receiptSummaryCard'),
  receiptSummaryContent: document.getElementById('receiptSummaryContent'),

  loading: document.getElementById('loading'),
  toast: document.getElementById('toast')
};

const state = {
  user: null,
  userDoc: null,
  shop: null,
  weekId: null,
  employees: [],
  statusByEmployeeId: {},
  paymentsByEmployeeWeek: {},
  receiptsByEmployeeWeek: {},
  selectedEmployeeId: null,
  searchText: '',
  filterMode: 'active',
  loading: {
    app: false,
    list: true,
    actionByEmployeeId: {}
  }
};

const unsubscribeFns = [];
let searchDebounceTimer = null;
let currentPaymentEmployeeId = null;
let currentConfirmAction = null;

function initializeThemeToggle() {
  const themeToggleBtn = document.getElementById('themeToggleBtn');
  if (!themeToggleBtn) return;

  const savedTheme = window.localStorage.getItem('brp-theme');
  if (savedTheme === 'dark') document.documentElement.classList.add('theme-dark');

  const refreshLabel = () => {
    const isDark = document.documentElement.classList.contains('theme-dark');
    themeToggleBtn.textContent = isDark ? 'Use light theme' : 'Use dark theme';
  };

  refreshLabel();
  themeToggleBtn.addEventListener('click', () => {
    document.documentElement.classList.toggle('theme-dark');
    const isDark = document.documentElement.classList.contains('theme-dark');
    window.localStorage.setItem('brp-theme', isDark ? 'dark' : 'light');
    refreshLabel();
  });
}
initializeThemeToggle();

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove('hidden');
  setTimeout(() => els.toast.classList.add('hidden'), 2800);
}

function setPageLoading(isLoading) {
  state.loading.app = isLoading;
  els.loading.classList.toggle('hidden', !isLoading);
}

function setButtonBusy(buttonElement, isBusy, busyText = 'Saving…') {
  if (!buttonElement) return;
  if (!buttonElement.dataset.defaultText) buttonElement.dataset.defaultText = buttonElement.textContent;
  buttonElement.disabled = isBusy;
  buttonElement.textContent = isBusy ? busyText : buttonElement.dataset.defaultText;
}

function centsToUsd(cents = 0) {
  return `$${(cents / 100).toFixed(2)}`;
}

function toWeekLabel(weekId) {
  const date = new Date(`${weekId}T00:00:00`);
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function getWeekStartDate(weekStartsOn = 'Monday') {
  const now = new Date();
  const day = now.getDay();
  const mondayOffset = day === 0 ? 6 : day - 1;
  const diff = weekStartsOn === 'Sunday' ? -day : -mondayOffset;
  now.setHours(0, 0, 0, 0);
  now.setDate(now.getDate() + diff);
  return now;
}

function getWeekId(weekStartsOn) {
  return getWeekStartDate(weekStartsOn).toISOString().slice(0, 10);
}

function employeeWeekKey(employeeId, weekId = state.weekId) {
  return `${employeeId}_${weekId}`;
}

function buildMailtoLink(to, subject, body) {
  const params = new URLSearchParams({ subject, body });
  return `mailto:${encodeURIComponent(to)}?${params.toString()}`;
}

function buildGmailComposeLink(to, subject, body) {
  const params = new URLSearchParams({ view: 'cm', fs: '1', to, su: subject, body });
  return `https://mail.google.com/mail/?${params.toString()}`;
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    return false;
  }
}

function getEmployeeById(employeeId) {
  return state.employees.find((employee) => employee.id === employeeId) || null;
}

function getPaymentsForEmployee(employeeId) {
  return state.paymentsByEmployeeWeek[employeeWeekKey(employeeId)] || [];
}

function getStatusForEmployee(employeeId) {
  return state.statusByEmployeeId[employeeId] || {
    status: 'PAST_DUE',
    totalPaidCents: 0,
    employeeId,
    weekId: state.weekId
  };
}

function getReceiptForEmployee(employeeId) {
  return state.receiptsByEmployeeWeek[employeeWeekKey(employeeId)] || null;
}

function getFilteredEmployees() {
  return state.employees
    .filter((employee) => state.filterMode === 'all' || employee.isActive)
    .filter((employee) => {
      const haystack = `${employee.name} ${employee.email}`.toLowerCase();
      return haystack.includes(state.searchText.toLowerCase());
    })
    .sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

function computeSummary() {
  const filteredEmployees = getFilteredEmployees();
  let totalDueCents = 0;
  let totalReceivedCents = 0;
  let pastDueCount = 0;
  let remindedCount = 0;

  filteredEmployees.forEach((employee) => {
    totalDueCents += employee.weeklyRentCents || 0;
    const status = getStatusForEmployee(employee.id);
    totalReceivedCents += status.totalPaidCents || 0;
    if (status.status === 'PAST_DUE') pastDueCount += 1;
    if (status.status === 'REMINDED') remindedCount += 1;
  });

  return { totalDueCents, totalReceivedCents, pastDueCount, remindedCount };
}

function renderSummary() {
  const summary = computeSummary();
  els.summaryTotalDue.textContent = centsToUsd(summary.totalDueCents);
  els.summaryTotalReceived.textContent = centsToUsd(summary.totalReceivedCents);
  els.summaryPastDue.textContent = String(summary.pastDueCount);
  els.summaryReminded.textContent = String(summary.remindedCount);
}

function renderEmployeeList() {
  if (state.loading.list) {
    els.employeeList.innerHTML = '<div class="skeleton-row"></div><div class="skeleton-row"></div><div class="skeleton-row"></div>';
    return;
  }

  const employees = getFilteredEmployees();
  if (!employees.length) {
    els.employeeList.innerHTML = '<div class="repo-row">No employees match your filters.</div>';
    return;
  }

  els.employeeList.innerHTML = '';
  employees.forEach((employee) => {
    const status = getStatusForEmployee(employee.id);
    const row = document.createElement('div');
    row.className = 'repo-row';
    row.innerHTML = `
      <div>
        <strong>${employee.name}</strong>
        <div class="helper">Paid ${centsToUsd(status.totalPaidCents || 0)} / ${centsToUsd(employee.weeklyRentCents || 0)} • Due ${employee.dueDay}</div>
      </div>
      <span class="badge ${status.status}">${status.status.replace('_', ' ')}</span>
    `;

    row.addEventListener('click', () => {
      state.selectedEmployeeId = employee.id;
      renderDrawer();
      els.drawer.classList.remove('hidden');
    });

    els.employeeList.appendChild(row);
  });
}

function renderDrawer() {
  const employee = getEmployeeById(state.selectedEmployeeId);
  if (!employee) {
    els.drawerContent.innerHTML = '<p class="helper">Select an employee to view details.</p>';
    return;
  }

  const status = getStatusForEmployee(employee.id);
  const payments = getPaymentsForEmployee(employee.id);
  const receipt = getReceiptForEmployee(employee.id);
  const progressPct = Math.min(100, Math.round(((status.totalPaidCents || 0) / Math.max(1, employee.weeklyRentCents || 1)) * 100));

  els.drawerTitle.textContent = employee.name;
  els.drawerContent.innerHTML = `
    <section class="stack">
      <div>
        <p><strong>Email:</strong> ${employee.email}</p>
        <p><strong>Status:</strong> <span class="badge ${status.status}">${status.status.replace('_', ' ')}</span></p>
      </div>
      <div>
        <p class="helper">Current week progress: ${centsToUsd(status.totalPaidCents || 0)} / ${centsToUsd(employee.weeklyRentCents || 0)}</p>
        <div class="progress-bar"><div class="progress-fill" style="width:${progressPct}%"></div></div>
      </div>
      <div class="drawer-actions">
        <button class="btn" id="drawerRemindBtn">Remind</button>
        <button class="btn secondary" id="drawerMarkPaidBtn">Mark Paid</button>
        <button class="btn danger" id="drawerPastDueBtn">Mark Past Due</button>
      </div>
      <div>
        <h4>Payment history (this week)</h4>
        <ul class="history-list">${payments.length ? payments.map((payment) => `<li>${centsToUsd(payment.amountCents)} via ${payment.method}</li>`).join('') : '<li class="helper">No payments yet.</li>'}</ul>
      </div>
      <div>
        <h4>Receipt</h4>
        ${receipt ? `<p class="helper">${receipt.receiptNumber} • ${centsToUsd(receipt.totalCents || 0)}</p>` : '<p class="helper">No receipt yet.</p>'}
      </div>
    </section>
  `;

  const remindBtn = document.getElementById('drawerRemindBtn');
  const markPaidBtn = document.getElementById('drawerMarkPaidBtn');
  const pastDueBtn = document.getElementById('drawerPastDueBtn');

  remindBtn.addEventListener('click', () => remindEmployee(employee.id, remindBtn));
  markPaidBtn.addEventListener('click', () => openPaymentModal(employee.id));
  pastDueBtn.addEventListener('click', () => openPastDueConfirm(employee.id));
}

function renderApp() {
  if (!state.shop) return;
  renderSummary();
  renderEmployeeList();
  if (state.selectedEmployeeId) renderDrawer();
}

async function loadOwnerContext(uid) {
  const userSnap = await getDoc(doc(db, 'users', uid));
  if (!userSnap.exists() || userSnap.data().role !== 'owner') {
    throw new Error('This account is not an owner account.');
  }

  state.userDoc = userSnap.data();
  const shopSnap = await getDoc(doc(db, 'shops', state.userDoc.shopId));
  if (!shopSnap.exists()) throw new Error('Shop document was not found.');

  state.shop = { id: shopSnap.id, ...shopSnap.data() };
  state.weekId = getWeekId(state.shop.weekStartsOn || 'Monday');

  els.shopTitle.textContent = `${state.shop.businessName} — Owner Dashboard`;
  els.weekLabel.textContent = `Current week: ${state.weekId}`;

  await setDoc(doc(db, 'shops', state.shop.id, 'weeks', state.weekId), {
    weekStart: state.weekId,
    createdAt: serverTimestamp()
  }, { merge: true });
}

function clearSnapshots() {
  while (unsubscribeFns.length) {
    const unsubscribe = unsubscribeFns.pop();
    unsubscribe();
  }
}

function startRealtimeListeners() {
  clearSnapshots();
  state.loading.list = true;
  renderApp();

  const employeesQuery = query(collection(db, 'shops', state.shop.id, 'employees'), orderBy('isActive', 'desc'), orderBy('name', 'asc'));
  const statusesQuery = query(collection(db, 'shops', state.shop.id, 'statuses'), where('weekId', '==', state.weekId));
  const paymentsQuery = query(collection(db, 'shops', state.shop.id, 'payments'), where('weekId', '==', state.weekId));
  const receiptsQuery = query(collection(db, 'shops', state.shop.id, 'receipts'), where('weekId', '==', state.weekId));

  unsubscribeFns.push(onSnapshot(employeesQuery, (snapshot) => {
    state.employees = snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
    state.loading.list = false;
    renderApp();
  }, (error) => handleFirestoreError('Failed to load employees in real-time.', error)));

  unsubscribeFns.push(onSnapshot(statusesQuery, (snapshot) => {
    const nextMap = {};
    snapshot.forEach((document) => {
      const data = document.data();
      nextMap[data.employeeId] = { id: document.id, ...data };
    });
    state.statusByEmployeeId = nextMap;
    renderApp();
  }, (error) => handleFirestoreError('Failed to load statuses in real-time.', error)));

  unsubscribeFns.push(onSnapshot(paymentsQuery, (snapshot) => {
    const nextMap = {};
    snapshot.forEach((document) => {
      const data = { id: document.id, ...document.data() };
      const key = employeeWeekKey(data.employeeId, data.weekId);
      if (!nextMap[key]) nextMap[key] = [];
      nextMap[key].push(data);
    });

    Object.keys(nextMap).forEach((key) => {
      nextMap[key].sort((a, b) => {
        const aMs = a.paidAt?.toMillis ? a.paidAt.toMillis() : 0;
        const bMs = b.paidAt?.toMillis ? b.paidAt.toMillis() : 0;
        return bMs - aMs;
      });
    });

    state.paymentsByEmployeeWeek = nextMap;
    renderApp();
  }, (error) => handleFirestoreError('Failed to load payments in real-time.', error)));

  unsubscribeFns.push(onSnapshot(receiptsQuery, (snapshot) => {
    const nextMap = {};
    snapshot.forEach((document) => {
      const data = { id: document.id, ...document.data() };
      nextMap[employeeWeekKey(data.employeeId, data.weekId)] = data;
    });
    state.receiptsByEmployeeWeek = nextMap;
    renderApp();
  }, (error) => handleFirestoreError('Failed to load receipts in real-time.', error)));
}

function handleFirestoreError(message, error) {
  console.error(message, error);
  const permissionHint = error?.code === 'permission-denied'
    ? ' Permissions error. Check that users/{uid} has shopId and role and Firestore rules allow access.'
    : '';
  showToast(`${message}${permissionHint}`);
}

function closePaymentModal() {
  els.paymentModalBackdrop.classList.add('hidden');
  els.paymentForm.reset();
  els.paymentAmountError.classList.add('hidden');
  currentPaymentEmployeeId = null;
}

function openPaymentModal(employeeId) {
  currentPaymentEmployeeId = employeeId;
  const now = new Date();
  const localIso = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  els.paymentPaidAt.value = localIso;
  els.paymentModalBackdrop.classList.remove('hidden');
}

function openConfirmModal(message, onConfirm) {
  currentConfirmAction = onConfirm;
  els.confirmMessage.textContent = message;
  els.confirmModalBackdrop.classList.remove('hidden');
}

function closeConfirmModal() {
  currentConfirmAction = null;
  els.confirmModalBackdrop.classList.add('hidden');
}

function closeEmailModal() {
  els.emailModalBackdrop.classList.add('hidden');
}

function openEmailComposer({ to, subject, body, receiptSummary }) {
  els.emailToInput.value = to;
  els.emailSubjectInput.value = subject;
  els.emailBodyInput.value = body;

  if (body.length > 1200) {
    els.emailLongBodyWarning.textContent = 'Long email body detected. Some email apps may shorten very long mailto links.';
  } else {
    els.emailLongBodyWarning.textContent = '';
  }

  if (receiptSummary) {
    els.receiptSummaryCard.classList.remove('hidden');
    els.receiptSummaryContent.innerHTML = `
      <div><strong>Receipt #:</strong> ${receiptSummary.receiptNumber}</div>
      <div><strong>Week of:</strong> ${receiptSummary.weekOf}</div>
      <div><strong>Payment methods:</strong> ${receiptSummary.methods}</div>
      <div><strong>Amount paid:</strong> ${receiptSummary.totalPaid}</div>
      <div><strong>Total rent:</strong> ${receiptSummary.weeklyRent}</div>
      <div><strong>Remaining:</strong> ${receiptSummary.remainingBalance}</div>
    `;
  } else {
    els.receiptSummaryCard.classList.add('hidden');
    els.receiptSummaryContent.innerHTML = '';
  }

  els.emailModalBackdrop.classList.remove('hidden');
}

function getComposerValues() {
  return {
    to: els.emailToInput.value.trim(),
    subject: els.emailSubjectInput.value.trim(),
    body: els.emailBodyInput.value.trim()
  };
}

function createReminderTemplate(employee) {
  const subject = `${state.shop.businessName} Rent Reminder — Week of ${toWeekLabel(state.weekId)}`;
  const body = `Hi ${employee.name},

This is a friendly reminder that your booth rent for the week of ${toWeekLabel(state.weekId)} is due.

Amount due: ${centsToUsd(employee.weeklyRentCents || 0)}
Due day: ${employee.dueDay}

If you already paid, thank you.
If you need help, contact us at ${state.shop.businessEmail || 'our front desk'}${state.shop.businessPhone ? ` or ${state.shop.businessPhone}` : ''}.

Thanks,
${state.shop.businessName}`;
  return { subject, body };
}

function createReceiptTemplate({ employee, receipt, totalPaidCents, methods }) {
  const weeklyRentCents = employee.weeklyRentCents || 0;
  const remainingCents = Math.max(0, weeklyRentCents - totalPaidCents);
  const subject = `${state.shop.businessName} Receipt ${receipt.receiptNumber} — Week of ${toWeekLabel(state.weekId)}`;
  const body = `Hi ${employee.name},

Thank you for your payment.

Receipt number: ${receipt.receiptNumber}
Week of: ${toWeekLabel(state.weekId)}
Amount received: ${centsToUsd(totalPaidCents)}
Payment method(s): ${methods}
Remaining balance: ${centsToUsd(remainingCents)}

If you need a PDF copy, we can attach one.

Best,
${state.shop.businessName}`;

  return {
    subject,
    body,
    summary: {
      receiptNumber: receipt.receiptNumber,
      weekOf: toWeekLabel(state.weekId),
      methods,
      totalPaid: centsToUsd(totalPaidCents),
      weeklyRent: centsToUsd(weeklyRentCents),
      remainingBalance: centsToUsd(remainingCents)
    }
  };
}

function getPaidStatus(totalPaidCents, weeklyRentCents, existingStatus = 'PAST_DUE') {
  if (totalPaidCents >= weeklyRentCents) return 'PAID';
  if (totalPaidCents > 0) return 'PARTIAL';
  return existingStatus;
}

async function markPastDue(employeeId, triggerButton) {
  const employee = getEmployeeById(employeeId);
  if (!employee) return;

  try {
    setButtonBusy(triggerButton, true, 'Saving…');

    const nextStatus = {
      employeeId,
      weekId: state.weekId,
      status: 'PAST_DUE',
      totalPaidCents: getStatusForEmployee(employeeId).totalPaidCents || 0,
      updatedAt: Timestamp.now(),
      updatedByUid: state.user.uid
    };

    state.statusByEmployeeId[employeeId] = nextStatus;
    renderApp();

    await setDoc(doc(db, 'shops', state.shop.id, 'statuses', employeeWeekKey(employeeId)), {
      ...nextStatus,
      updatedAt: serverTimestamp()
    }, { merge: true });

    await addDoc(collection(db, 'shops', state.shop.id, 'auditLogs'), {
      actionType: 'MARK_PAST_DUE',
      employeeId,
      weekId: state.weekId,
      details: {},
      actorUid: state.user.uid,
      createdAt: serverTimestamp()
    });

    showToast(`${employee.name} marked as past due.`);
  } catch (error) {
    console.error('markPastDue failed', error);
    showToast(`Could not mark past due: ${error.message}`);
  } finally {
    setButtonBusy(triggerButton, false);
  }
}

async function ensureReceiptNumber() {
  const shopRef = doc(db, 'shops', state.shop.id);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(shopRef);
    const next = snap.data()?.nextReceiptSeq || 1;
    tx.update(shopRef, { nextReceiptSeq: next + 1 });
    const year = new Date().getFullYear();
    return `BRP-${year}-${String(next).padStart(6, '0')}`;
  });
}

async function upsertReceiptDraft(employeeId, lineItems) {
  const receiptDocRef = doc(db, 'shops', state.shop.id, 'receipts', employeeWeekKey(employeeId));
  const existing = getReceiptForEmployee(employeeId);
  const receiptNumber = existing?.receiptNumber || await ensureReceiptNumber();
  const totalCents = lineItems.reduce((sum, item) => sum + item.amountCents, 0);

  const draftData = {
    employeeId,
    weekId: state.weekId,
    receiptNumber,
    totalCents,
    lineItems,
    issuedAt: serverTimestamp(),
    createdByUid: state.user.uid
  };

  // Optimistic update for immediate UI feedback.
  state.receiptsByEmployeeWeek[employeeWeekKey(employeeId)] = {
    id: receiptDocRef.id,
    employeeId,
    weekId: state.weekId,
    receiptNumber,
    totalCents,
    lineItems
  };
  renderApp();

  await setDoc(receiptDocRef, draftData, { merge: true });
  return { id: receiptDocRef.id, receiptNumber, totalCents, lineItems };
}

async function recordPayment(employeeId, amountCents, method, paidAtDate, notes, triggerButton) {
  const employee = getEmployeeById(employeeId);
  if (!employee) return;

  try {
    setButtonBusy(triggerButton, true, 'Saving…');

    const optimisticPayment = {
      id: `local-${Date.now()}`,
      employeeId,
      weekId: state.weekId,
      amountCents,
      method,
      paidAt: Timestamp.fromDate(paidAtDate),
      notes
    };

    const paymentKey = employeeWeekKey(employeeId);
    if (!state.paymentsByEmployeeWeek[paymentKey]) state.paymentsByEmployeeWeek[paymentKey] = [];
    state.paymentsByEmployeeWeek[paymentKey] = [optimisticPayment, ...state.paymentsByEmployeeWeek[paymentKey]];

    const optimisticTotal = state.paymentsByEmployeeWeek[paymentKey].reduce((sum, payment) => sum + (payment.amountCents || 0), 0);
    state.statusByEmployeeId[employeeId] = {
      ...(getStatusForEmployee(employeeId)),
      employeeId,
      weekId: state.weekId,
      status: getPaidStatus(optimisticTotal, employee.weeklyRentCents || 0, getStatusForEmployee(employeeId).status),
      totalPaidCents: optimisticTotal,
      updatedAt: Timestamp.now(),
      updatedByUid: state.user.uid
    };

    renderApp();

    await addDoc(collection(db, 'shops', state.shop.id, 'payments'), {
      employeeId,
      weekId: state.weekId,
      amountCents,
      method,
      paidAt: Timestamp.fromDate(paidAtDate),
      notes,
      createdAt: serverTimestamp(),
      createdByUid: state.user.uid
    });

    const freshPayments = await getDocs(query(
      collection(db, 'shops', state.shop.id, 'payments'),
      where('employeeId', '==', employeeId),
      where('weekId', '==', state.weekId)
    ));

    const lineItems = freshPayments.docs.map((document) => {
      const data = document.data();
      return {
        paidAt: data.paidAt || null,
        method: data.method,
        amountCents: data.amountCents,
        notes: data.notes || ''
      };
    });

    const totalPaidCents = lineItems.reduce((sum, payment) => sum + payment.amountCents, 0);
    const nextStatus = getPaidStatus(totalPaidCents, employee.weeklyRentCents || 0, getStatusForEmployee(employeeId).status);

    await setDoc(doc(db, 'shops', state.shop.id, 'statuses', employeeWeekKey(employeeId)), {
      employeeId,
      weekId: state.weekId,
      status: nextStatus,
      totalPaidCents,
      updatedAt: serverTimestamp(),
      updatedByUid: state.user.uid
    }, { merge: true });

    const receipt = await upsertReceiptDraft(employeeId, lineItems);
    const uniqueMethods = [...new Set(lineItems.map((item) => item.method))].join(', ');

    await addDoc(collection(db, 'shops', state.shop.id, 'auditLogs'), {
      actionType: 'MARK_PAID',
      employeeId,
      weekId: state.weekId,
      details: { amountCents, method, receiptId: receipt.id, emailPreviewGenerated: true },
      actorUid: state.user.uid,
      createdAt: serverTimestamp()
    });

    const template = createReceiptTemplate({ employee, receipt, totalPaidCents, methods: uniqueMethods || method });
    openEmailComposer({ to: employee.email, subject: template.subject, body: template.body, receiptSummary: template.summary });

    showToast(`Payment recorded for ${employee.name}.`);
  } catch (error) {
    console.error('recordPayment failed', error);
    showToast(`Could not record payment: ${error.message}`);
  } finally {
    setButtonBusy(triggerButton, false);
  }
}

async function remindEmployee(employeeId, triggerButton) {
  const employee = getEmployeeById(employeeId);
  if (!employee) return;

  try {
    setButtonBusy(triggerButton, true, 'Working…');

    const currentStatus = getStatusForEmployee(employeeId);
    state.statusByEmployeeId[employeeId] = {
      ...currentStatus,
      employeeId,
      weekId: state.weekId,
      status: 'REMINDED',
      totalPaidCents: currentStatus.totalPaidCents || 0,
      lastRemindedAt: Timestamp.now(),
      lastEmailedAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      updatedByUid: state.user.uid
    };
    renderApp();

    await setDoc(doc(db, 'shops', state.shop.id, 'statuses', employeeWeekKey(employeeId)), {
      employeeId,
      weekId: state.weekId,
      status: 'REMINDED',
      totalPaidCents: currentStatus.totalPaidCents || 0,
      lastRemindedAt: serverTimestamp(),
      lastEmailedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedByUid: state.user.uid
    }, { merge: true });

    await addDoc(collection(db, 'shops', state.shop.id, 'auditLogs'), {
      actionType: 'REMIND_EMAIL_PREVIEW_GENERATED',
      employeeId,
      weekId: state.weekId,
      details: { previewOnly: true },
      actorUid: state.user.uid,
      createdAt: serverTimestamp()
    });

    const template = createReminderTemplate(employee);
    openEmailComposer({ to: employee.email, subject: template.subject, body: template.body });
    showToast(`Reminder prepared for ${employee.name}.`);
  } catch (error) {
    console.error('remindEmployee failed', error);
    showToast(`Could not prepare reminder: ${error.message}`);
  } finally {
    setButtonBusy(triggerButton, false);
  }
}

function openPastDueConfirm(employeeId) {
  const employee = getEmployeeById(employeeId);
  if (!employee) return;

  openConfirmModal(
    `Mark ${employee.name} as past due for week ${toWeekLabel(state.weekId)}? This updates their status immediately.`,
    async () => {
      await markPastDue(employeeId, els.confirmActionBtn);
      closeConfirmModal();
    }
  );
}

function resetUiOnLogout() {
  clearSnapshots();
  state.user = null;
  state.userDoc = null;
  state.shop = null;
  state.weekId = null;
  state.employees = [];
  state.statusByEmployeeId = {};
  state.paymentsByEmployeeWeek = {};
  state.receiptsByEmployeeWeek = {};
  state.selectedEmployeeId = null;

  els.ownerLoginCard.classList.remove('hidden');
  els.dashboard.classList.add('hidden');
  els.logoutBtn.classList.add('hidden');
  els.authEmail.textContent = '';
  els.drawer.classList.add('hidden');
}

els.searchInput.addEventListener('input', () => {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    state.searchText = els.searchInput.value.trim();
    renderApp();
  }, 180);
});

els.statusFilter.addEventListener('change', () => {
  state.filterMode = els.statusFilter.value;
  renderApp();
});

els.closeDrawerBtn.addEventListener('click', () => {
  els.drawer.classList.add('hidden');
  state.selectedEmployeeId = null;
});

els.closePaymentModalBtn.addEventListener('click', closePaymentModal);
els.cancelPaymentBtn.addEventListener('click', closePaymentModal);
els.paymentModalBackdrop.addEventListener('click', (event) => {
  if (event.target === els.paymentModalBackdrop) closePaymentModal();
});

els.paymentForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!currentPaymentEmployeeId) return;

  const amountCents = Math.round(Number(els.paymentAmount.value) * 100);
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    els.paymentAmountError.textContent = 'Enter a valid amount greater than 0.';
    els.paymentAmountError.classList.remove('hidden');
    return;
  }

  els.paymentAmountError.classList.add('hidden');
  const method = els.paymentMethod.value;
  const notes = els.paymentNotes.value.trim();
  const paidAtDate = els.paymentPaidAt.value ? new Date(els.paymentPaidAt.value) : new Date();

  await recordPayment(currentPaymentEmployeeId, amountCents, method, paidAtDate, notes, els.savePaymentBtn);
  closePaymentModal();
});

els.confirmActionBtn.addEventListener('click', async () => {
  if (!currentConfirmAction) return;
  await currentConfirmAction();
});
els.cancelConfirmBtn.addEventListener('click', closeConfirmModal);
els.confirmModalBackdrop.addEventListener('click', (event) => {
  if (event.target === els.confirmModalBackdrop) closeConfirmModal();
});

els.closeEmailModalBtn.addEventListener('click', closeEmailModal);
els.cancelEmailBtn.addEventListener('click', closeEmailModal);
els.emailModalBackdrop.addEventListener('click', (event) => {
  if (event.target === els.emailModalBackdrop) closeEmailModal();
});

els.copySubjectBtn.addEventListener('click', async () => {
  const ok = await copyToClipboard(els.emailSubjectInput.value);
  showToast(ok ? 'Subject copied.' : 'Clipboard blocked. Copy subject manually.');
});

els.copyBodyBtn.addEventListener('click', async () => {
  const ok = await copyToClipboard(els.emailBodyInput.value);
  showToast(ok ? 'Body copied.' : 'Clipboard blocked. Copy body manually.');
});

els.copyEmailBtn.addEventListener('click', async () => {
  const values = getComposerValues();
  const formatted = `Subject: ${values.subject}\n\nBody:\n${values.body}`;
  const ok = await copyToClipboard(formatted);
  showToast(ok ? 'Email text copied.' : 'Clipboard blocked. Copy email manually.');
});

els.openMailAppBtn.addEventListener('click', () => {
  const values = getComposerValues();
  if (!values.to) return showToast('Please enter a recipient email.');
  window.location.href = buildMailtoLink(values.to, values.subject, values.body);
});

els.openGmailBtn.addEventListener('click', () => {
  const values = getComposerValues();
  if (!values.to) return showToast('Please enter a recipient email.');
  window.open(buildGmailComposeLink(values.to, values.subject, values.body), '_blank', 'noopener,noreferrer');
  showToast('Gmail compose opened in a new tab.');
});

els.ownerLoginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    setPageLoading(true);
    await signInWithEmailAndPassword(auth, els.ownerEmail.value, els.ownerPassword.value);
  } catch (error) {
    console.error('owner login failed', error);
    showToast(`Login failed: ${error.message}`);
  } finally {
    setPageLoading(false);
  }
});

els.logoutBtn.addEventListener('click', () => signOut(auth));

els.addEmployeeForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.shop) return;

  try {
    setButtonBusy(els.addEmployeeBtn, true, 'Creating…');
    await addDoc(collection(db, 'shops', state.shop.id, 'employees'), {
      name: document.getElementById('empName').value.trim(),
      email: document.getElementById('empEmail').value.trim().toLowerCase(),
      weeklyRentCents: Math.round(Number(document.getElementById('empWeeklyRent').value) * 100),
      dueDay: document.getElementById('empDueDay').value,
      isActive: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    els.addEmployeeForm.reset();
    showToast('Employee created successfully.');
  } catch (error) {
    console.error('create employee failed', error);
    showToast(`Could not create employee: ${error.message}`);
  } finally {
    setButtonBusy(els.addEmployeeBtn, false);
  }
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    resetUiOnLogout();
    return;
  }

  state.user = user;

  try {
    setPageLoading(true);
    await loadOwnerContext(user.uid);

    els.ownerLoginCard.classList.add('hidden');
    els.dashboard.classList.remove('hidden');
    els.logoutBtn.classList.remove('hidden');
    els.authEmail.textContent = user.email;

    startRealtimeListeners();
  } catch (error) {
    console.error('load owner context failed', error);
    showToast(`Could not load dashboard: ${error.message}`);
    await signOut(auth);
  } finally {
    setPageLoading(false);
  }
});

export { buildMailtoLink, buildGmailComposeLink, copyToClipboard };
