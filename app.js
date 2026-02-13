import { auth, db, functions } from './firebase-config.js';
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
  where
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js';

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
  addEmployeeForm: document.getElementById('addEmployeeForm'),
  employeeList: document.getElementById('employeeList'),
  detailsPanel: document.getElementById('detailsPanel'),
  closePanel: document.getElementById('closePanel'),
  panelTitle: document.getElementById('panelTitle'),
  panelContent: document.getElementById('panelContent'),
  loading: document.getElementById('loading'),
  toast: document.getElementById('toast')
};

let currentOwnerUser = null;
let currentUserDoc = null;
let currentShopDoc = null;
let currentWeekId = null;
let employees = [];


function initializeThemeToggle() {
  const themeToggleBtn = document.getElementById('themeToggleBtn');
  if (!themeToggleBtn) return;

  const savedTheme = window.localStorage.getItem('brp-theme');
  if (savedTheme === 'dark') {
    document.documentElement.classList.add('theme-dark');
  }

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
  setTimeout(() => els.toast.classList.add('hidden'), 2600);
}
function setLoading(isLoading) { els.loading.classList.toggle('hidden', !isLoading); }
function centsToUsd(cents) { return `$${(cents / 100).toFixed(2)}`; }

function getWeekStartDate(weekStartsOn = 'Monday') {
  const now = new Date();
  const day = now.getDay(); // Sunday=0
  const mondayDay = day === 0 ? 6 : day - 1;
  const diff = weekStartsOn === 'Sunday' ? -day : -mondayDay;
  now.setHours(0, 0, 0, 0);
  now.setDate(now.getDate() + diff);
  return now;
}
function getWeekId(weekStartsOn) { return getWeekStartDate(weekStartsOn).toISOString().slice(0, 10); }

async function loadOwnerContext(uid) {
  const userSnap = await getDoc(doc(db, 'users', uid));
  if (!userSnap.exists() || userSnap.data().role !== 'owner') throw new Error('This account is not an owner.');
  currentUserDoc = userSnap.data();
  const shopSnap = await getDoc(doc(db, 'shops', currentUserDoc.shopId));
  if (!shopSnap.exists()) throw new Error('Shop document missing.');
  currentShopDoc = { id: shopSnap.id, ...shopSnap.data() };
  currentWeekId = getWeekId(currentShopDoc.weekStartsOn || 'Monday');
  els.shopTitle.textContent = `${currentShopDoc.businessName} — Owner Dashboard`;
  els.weekLabel.textContent = `Current week: ${currentWeekId}`;

  await setDoc(doc(db, 'shops', currentShopDoc.id, 'weeks', currentWeekId), {
    weekStart: currentWeekId,
    createdAt: serverTimestamp()
  }, { merge: true });
}

function statusFromTotals(totalPaidCents, weeklyRentCents, currentStatus = 'PAST_DUE') {
  if (totalPaidCents >= weeklyRentCents) return 'PAID';
  if (totalPaidCents > 0) return 'PARTIAL';
  return currentStatus;
}

async function recomputeAndSetStatus(shopId, employeeId, weeklyRentCents, baseStatus = 'PAST_DUE') {
  const q = query(collection(db, 'shops', shopId, 'payments'), where('employeeId', '==', employeeId), where('weekId', '==', currentWeekId));
  const paymentSnaps = await getDocs(q);
  const totalPaidCents = paymentSnaps.docs.reduce((sum, d) => sum + (d.data().amountCents || 0), 0);
  const status = statusFromTotals(totalPaidCents, weeklyRentCents, baseStatus);
  await setDoc(doc(db, 'shops', shopId, 'statuses', `${employeeId}_${currentWeekId}`), {
    employeeId,
    weekId: currentWeekId,
    status,
    totalPaidCents,
    updatedAt: serverTimestamp(),
    updatedByUid: currentOwnerUser.uid,
    lastRemindedAt: null
  }, { merge: true });
  return { totalPaidCents, status, payments: paymentSnaps.docs.map(d => ({ id: d.id, ...d.data() })) };
}

function renderEmployees(statusMap = {}) {
  if (!employees.length) {
    els.employeeList.innerHTML = '<div class="repo-row">No employees yet.</div>';
    return;
  }
  els.employeeList.innerHTML = '';
  employees.forEach((emp) => {
    const statusDoc = statusMap[`${emp.id}_${currentWeekId}`] || { status: 'PAST_DUE', totalPaidCents: 0 };
    const row = document.createElement('div');
    row.className = 'repo-row';
    row.innerHTML = `
      <div>
        <strong>${emp.name}</strong>
        <div class="helper">Paid ${centsToUsd(statusDoc.totalPaidCents || 0)} / ${centsToUsd(emp.weeklyRentCents || 0)}</div>
      </div>
      <span class="badge ${statusDoc.status}">${statusDoc.status.replace('_', ' ')}</span>
    `;
    row.addEventListener('click', () => openEmployeePanel(emp, statusDoc));
    els.employeeList.appendChild(row);
  });
}

async function createReceipt(shopId, employee, payments) {
  const shopRef = doc(db, 'shops', shopId);
  const receiptSeq = await runTransaction(db, async (tx) => {
    const snap = await tx.get(shopRef);
    const next = (snap.data()?.nextReceiptSeq || 1);
    tx.update(shopRef, { nextReceiptSeq: next + 1 });
    return next;
  });
  const year = new Date().getFullYear();
  const receiptNumber = `BRP-${year}-${String(receiptSeq).padStart(6, '0')}`;
  const receiptRef = doc(collection(db, 'shops', shopId, 'receipts'));
  const totalCents = payments.reduce((sum, p) => sum + p.amountCents, 0);

  await setDoc(receiptRef, {
    employeeId: employee.id,
    weekId: currentWeekId,
    receiptNumber,
    totalCents,
    lineItems: payments.map((p) => ({ paidAt: p.paidAt || null, method: p.method, amountCents: p.amountCents, notes: p.notes || '' })),
    issuedAt: serverTimestamp(),
    createdByUid: currentOwnerUser.uid
  });
  return receiptRef.id;
}

async function openEmployeePanel(employee, statusDoc) {
  els.detailsPanel.classList.remove('hidden');
  els.panelTitle.textContent = employee.name;
  els.panelContent.innerHTML = `<p>Email: ${employee.email}</p><p>Status: <strong>${statusDoc.status}</strong></p>`;

  const actions = document.createElement('div');
  actions.className = 'stack';
  actions.innerHTML = `
    <button class="btn" id="inviteBtn">Invite staff login</button>
    <button class="btn" id="remindBtn">Remind</button>
    <button class="btn" id="markPaidBtn">Mark Paid</button>
    <button class="btn secondary" id="pastDueBtn">Mark Past Due</button>
  `;
  els.panelContent.appendChild(actions);

  const history = document.createElement('div');
  history.innerHTML = '<h4>History</h4>';
  els.panelContent.appendChild(history);

  document.getElementById('inviteBtn').onclick = async () => {
    try {
      setLoading(true);
      const inviteRef = await addDoc(collection(db, 'shops', currentShopDoc.id, 'invites'), {
        email: employee.email.toLowerCase(),
        employeeId: employee.id,
        role: 'staff',
        createdAt: serverTimestamp(),
        expiresAt: new Date(Date.now() + (1000 * 60 * 60 * 24 * 7)),
        used: false,
        usedAt: null
      });
      await addDoc(collection(db, 'shops', currentShopDoc.id, 'auditLogs'), {
        actionType: 'INVITE_CREATED', employeeId: employee.id, weekId: currentWeekId,
        details: { inviteId: inviteRef.id }, actorUid: currentOwnerUser.uid, createdAt: serverTimestamp()
      });
      await httpsCallable(functions, 'sendReminderEmail')({ shopId: currentShopDoc.id, employeeId: employee.id, weekId: currentWeekId, mode: 'INVITE', inviteId: inviteRef.id });
      showToast('Invite email queued.');
    } catch (e) {
      showToast(e.message);
    } finally { setLoading(false); }
  };

  document.getElementById('remindBtn').onclick = async () => {
    try {
      setLoading(true);
      await setDoc(doc(db, 'shops', currentShopDoc.id, 'statuses', `${employee.id}_${currentWeekId}`), {
        employeeId: employee.id,
        weekId: currentWeekId,
        status: 'REMINDED',
        lastRemindedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedByUid: currentOwnerUser.uid
      }, { merge: true });
      await addDoc(collection(db, 'shops', currentShopDoc.id, 'auditLogs'), {
        actionType: 'REMIND', employeeId: employee.id, weekId: currentWeekId,
        details: {}, actorUid: currentOwnerUser.uid, createdAt: serverTimestamp()
      });
      await httpsCallable(functions, 'sendReminderEmail')({ shopId: currentShopDoc.id, employeeId: employee.id, weekId: currentWeekId });
      showToast('Reminder email queued.');
    } catch (e) { showToast(e.message); } finally { setLoading(false); }
  };

  document.getElementById('pastDueBtn').onclick = async () => {
    try {
      setLoading(true);
      await setDoc(doc(db, 'shops', currentShopDoc.id, 'statuses', `${employee.id}_${currentWeekId}`), {
        employeeId: employee.id,
        weekId: currentWeekId,
        status: 'PAST_DUE',
        updatedAt: serverTimestamp(),
        updatedByUid: currentOwnerUser.uid
      }, { merge: true });
      await addDoc(collection(db, 'shops', currentShopDoc.id, 'auditLogs'), {
        actionType: 'MARK_PAST_DUE', employeeId: employee.id, weekId: currentWeekId,
        details: {}, actorUid: currentOwnerUser.uid, createdAt: serverTimestamp()
      });
      showToast('Marked as past due.');
    } catch (e) { showToast(e.message); } finally { setLoading(false); }
  };

  document.getElementById('markPaidBtn').onclick = async () => {
    const amount = prompt('Amount paid (example: 50.00)');
    if (!amount) return;
    const method = prompt('Payment method: Cash/Card/CashApp/Venmo/Zelle/Other', 'Cash') || 'Other';
    const notes = prompt('Notes (optional)', '') || '';
    const cents = Math.round(Number(amount) * 100);
    if (!Number.isFinite(cents) || cents <= 0) return showToast('Enter a valid amount.');

    try {
      setLoading(true);
      await addDoc(collection(db, 'shops', currentShopDoc.id, 'payments'), {
        employeeId: employee.id,
        weekId: currentWeekId,
        amountCents: cents,
        method,
        paidAt: serverTimestamp(),
        notes,
        createdAt: serverTimestamp(),
        createdByUid: currentOwnerUser.uid
      });
      const statusData = await recomputeAndSetStatus(currentShopDoc.id, employee.id, employee.weeklyRentCents, statusDoc.status);
      const receiptId = await createReceipt(currentShopDoc.id, employee, statusData.payments);
      await httpsCallable(functions, 'sendReceiptEmail')({ shopId: currentShopDoc.id, employeeId: employee.id, receiptId });
      await addDoc(collection(db, 'shops', currentShopDoc.id, 'auditLogs'), {
        actionType: 'MARK_PAID', employeeId: employee.id, weekId: currentWeekId,
        details: { amountCents: cents, method, receiptId }, actorUid: currentOwnerUser.uid, createdAt: serverTimestamp()
      });
      showToast('Payment saved + receipt email queued.');
    } catch (e) { showToast(e.message); } finally { setLoading(false); }
  };

  const paymentSnap = await getDocs(query(collection(db, 'shops', currentShopDoc.id, 'payments'), where('employeeId', '==', employee.id), orderBy('createdAt', 'desc')));
  const receiptSnap = await getDocs(query(collection(db, 'shops', currentShopDoc.id, 'receipts'), where('employeeId', '==', employee.id), orderBy('issuedAt', 'desc')));
  history.innerHTML += `<p>Payments: ${paymentSnap.size}, Receipts: ${receiptSnap.size}</p>`;
}

els.ownerLoginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    setLoading(true);
    await signInWithEmailAndPassword(auth, els.ownerEmail.value, els.ownerPassword.value);
  } catch (error) {
    showToast(error.message);
  } finally { setLoading(false); }
});
els.logoutBtn.addEventListener('click', () => signOut(auth));
els.closePanel.addEventListener('click', () => els.detailsPanel.classList.add('hidden'));

els.addEmployeeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentShopDoc) return;
  try {
    setLoading(true);
    await addDoc(collection(db, 'shops', currentShopDoc.id, 'employees'), {
      name: document.getElementById('empName').value.trim(),
      email: document.getElementById('empEmail').value.trim().toLowerCase(),
      weeklyRentCents: Math.round(Number(document.getElementById('empWeeklyRent').value) * 100),
      dueDay: document.getElementById('empDueDay').value,
      isActive: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    els.addEmployeeForm.reset();
    showToast('Employee created.');
  } catch (error) {
    showToast(error.message);
  } finally { setLoading(false); }
});

onAuthStateChanged(auth, async (user) => {
  currentOwnerUser = user;
  if (!user) {
    els.ownerLoginCard.classList.remove('hidden');
    els.dashboard.classList.add('hidden');
    els.logoutBtn.classList.add('hidden');
    els.authEmail.textContent = '';
    return;
  }
  try {
    setLoading(true);
    await loadOwnerContext(user.uid);
    els.ownerLoginCard.classList.add('hidden');
    els.dashboard.classList.remove('hidden');
    els.logoutBtn.classList.remove('hidden');
    els.authEmail.textContent = user.email;

    onSnapshot(collection(db, 'shops', currentShopDoc.id, 'employees'), (snap) => {
      employees = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      getDocs(query(collection(db, 'shops', currentShopDoc.id, 'statuses'), where('weekId', '==', currentWeekId))).then((statusSnap) => {
        const statusMap = Object.fromEntries(statusSnap.docs.map((d) => [d.id, d.data()]));
        renderEmployees(statusMap);
      });
    });
  } catch (error) {
    showToast(error.message);
    await signOut(auth);
  } finally { setLoading(false); }
});
