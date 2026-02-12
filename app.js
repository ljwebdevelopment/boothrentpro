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
  addEmployeeForm: document.getElementById('addEmployeeForm'),
  employeeList: document.getElementById('employeeList'),
  detailsPanel: document.getElementById('detailsPanel'),
  closePanel: document.getElementById('closePanel'),
  panelTitle: document.getElementById('panelTitle'),
  panelContent: document.getElementById('panelContent'),
  loading: document.getElementById('loading'),
  toast: document.getElementById('toast'),
  emailModalBackdrop: document.getElementById('emailModalBackdrop'),
  closeEmailModalBtn: document.getElementById('closeEmailModalBtn'),
  emailToInput: document.getElementById('emailToInput'),
  emailSubjectInput: document.getElementById('emailSubjectInput'),
  emailBodyInput: document.getElementById('emailBodyInput'),
  copyEmailBtn: document.getElementById('copyEmailBtn'),
  openMailAppBtn: document.getElementById('openMailAppBtn'),
  openGmailBtn: document.getElementById('openGmailBtn'),
  cancelEmailBtn: document.getElementById('cancelEmailBtn'),
  copySubjectBtn: document.getElementById('copySubjectBtn'),
  copyBodyBtn: document.getElementById('copyBodyBtn'),
  receiptSummaryCard: document.getElementById('receiptSummaryCard'),
  receiptSummaryContent: document.getElementById('receiptSummaryContent')
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
  setTimeout(() => els.toast.classList.add('hidden'), 2600);
}
function setLoading(isLoading) { els.loading.classList.toggle('hidden', !isLoading); }
function centsToUsd(cents) { return `$${(cents / 100).toFixed(2)}`; }
function weekLabel(weekId) {
  const date = new Date(`${weekId}T00:00:00`);
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function getWeekStartDate(weekStartsOn = 'Monday') {
  const now = new Date();
  const day = now.getDay();
  const mondayDay = day === 0 ? 6 : day - 1;
  const diff = weekStartsOn === 'Sunday' ? -day : -mondayDay;
  now.setHours(0, 0, 0, 0);
  now.setDate(now.getDate() + diff);
  return now;
}
function getWeekId(weekStartsOn) { return getWeekStartDate(weekStartsOn).toISOString().slice(0, 10); }

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

let modalState = { to: '', subject: '', body: '' };

function closeEmailModal() {
  els.emailModalBackdrop.classList.add('hidden');
}

function openEmailComposer({ to, subject, body, receiptSummary }) {
  modalState = { to, subject, body };
  els.emailToInput.value = to;
  els.emailSubjectInput.value = subject;
  els.emailBodyInput.value = body;

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
    body: els.emailBodyInput.value
  };
}

els.closeEmailModalBtn.addEventListener('click', closeEmailModal);
els.cancelEmailBtn.addEventListener('click', closeEmailModal);
els.emailModalBackdrop.addEventListener('click', (event) => {
  if (event.target === els.emailModalBackdrop) closeEmailModal();
});

els.copySubjectBtn.addEventListener('click', async () => {
  const ok = await copyToClipboard(els.emailSubjectInput.value);
  if (ok) showToast('Subject copied!');
  else showToast('Clipboard blocked. Select the text and copy manually.');
});

els.copyBodyBtn.addEventListener('click', async () => {
  const ok = await copyToClipboard(els.emailBodyInput.value);
  if (ok) showToast('Body copied!');
  else showToast('Clipboard blocked. Select the text and copy manually.');
});

els.copyEmailBtn.addEventListener('click', async () => {
  const { subject, body } = getComposerValues();
  const combined = `Subject: ${subject}\n\nBody:\n${body}`;
  const ok = await copyToClipboard(combined);
  if (ok) showToast('Copied!');
  else showToast('Clipboard blocked. Select the message and copy manually.');
});

els.openMailAppBtn.addEventListener('click', () => {
  const { to, subject, body } = getComposerValues();
  if (!to) return showToast('Please enter a recipient email first.');
  window.location.href = buildMailtoLink(to, subject, body);
});

els.openGmailBtn.addEventListener('click', () => {
  const { to, subject, body } = getComposerValues();
  if (!to) return showToast('Please enter a recipient email first.');
  window.open(buildGmailComposeLink(to, subject, body), '_blank', 'noopener,noreferrer');
  showToast('Gmail compose opened in a new tab.');
});

function createReminderTemplate(employee) {
  const subject = `${currentShopDoc.businessName} Rent Reminder — Week of ${weekLabel(currentWeekId)}`;
  const dueAmount = centsToUsd(employee.weeklyRentCents || 0);
  const body = `Hi ${employee.name},

This is a friendly reminder that your booth rent for the week of ${weekLabel(currentWeekId)} is due.

Amount due: ${dueAmount}
Due day: ${employee.dueDay}

If you have already paid, thank you and please ignore this reminder.
If you have questions, contact us at ${currentShopDoc.businessEmail || 'our front desk'}${currentShopDoc.businessPhone ? ` or ${currentShopDoc.businessPhone}` : ''}.

Thank you,
${currentShopDoc.businessName}`;

  return { subject, body };
}

function createReceiptTemplate({ employee, receipt, totalPaidCents, methods }) {
  const weeklyRentCents = employee.weeklyRentCents || 0;
  const remainingCents = Math.max(0, weeklyRentCents - totalPaidCents);
  const subject = `${currentShopDoc.businessName} Receipt ${receipt.receiptNumber} — Week of ${weekLabel(currentWeekId)}`;
  const body = `Hi ${employee.name},

Thank you for your payment.

Receipt number: ${receipt.receiptNumber}
Week of: ${weekLabel(currentWeekId)}
Amount received: ${centsToUsd(totalPaidCents)}
Payment method(s): ${methods}
Remaining balance: ${centsToUsd(remainingCents)}

If you need a PDF copy, we can attach one on request.

Best,
${currentShopDoc.businessName}`;

  return {
    subject,
    body,
    summary: {
      receiptNumber: receipt.receiptNumber,
      weekOf: weekLabel(currentWeekId),
      methods,
      totalPaid: centsToUsd(totalPaidCents),
      weeklyRent: centsToUsd(weeklyRentCents),
      remainingBalance: centsToUsd(remainingCents)
    }
  };
}

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
    updatedByUid: currentOwnerUser.uid
  }, { merge: true });

  return { totalPaidCents, status, payments: paymentSnaps.docs.map((d) => ({ id: d.id, ...d.data() })) };
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
  const totalCents = payments.reduce((sum, payment) => sum + payment.amountCents, 0);

  await setDoc(receiptRef, {
    employeeId: employee.id,
    weekId: currentWeekId,
    receiptNumber,
    totalCents,
    lineItems: payments.map((payment) => ({
      paidAt: payment.paidAt || null,
      method: payment.method,
      amountCents: payment.amountCents,
      notes: payment.notes || ''
    })),
    issuedAt: serverTimestamp(),
    createdByUid: currentOwnerUser.uid
  });

  return { id: receiptRef.id, receiptNumber, totalCents };
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

      const inviteLinkBase = currentShopDoc.staffPortalBaseUrl || `${window.location.origin}/staff.html`;
      const inviteLink = `${inviteLinkBase}?invite=${inviteRef.id}`;
      const subject = `${currentShopDoc.businessName} staff portal invite`;
      const body = `Hi ${employee.name},

You are invited to join the ${currentShopDoc.businessName} staff portal.

Open this secure invite link:
${inviteLink}

If the link expires, please request a new invite.

Thanks,
${currentShopDoc.businessName}`;

      await addDoc(collection(db, 'shops', currentShopDoc.id, 'auditLogs'), {
        actionType: 'INVITE_CREATED',
        employeeId: employee.id,
        weekId: currentWeekId,
        details: { inviteId: inviteRef.id, emailPreviewGenerated: true },
        actorUid: currentOwnerUser.uid,
        createdAt: serverTimestamp()
      });

      openEmailComposer({ to: employee.email, subject, body });
      showToast('Invite created. Send it using the composer.');
    } catch (error) {
      showToast(error.message);
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
        lastEmailedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedByUid: currentOwnerUser.uid
      }, { merge: true });

      await addDoc(collection(db, 'shops', currentShopDoc.id, 'auditLogs'), {
        actionType: 'REMIND_EMAIL_PREVIEW_GENERATED',
        employeeId: employee.id,
        weekId: currentWeekId,
        details: { previewOnly: true },
        actorUid: currentOwnerUser.uid,
        createdAt: serverTimestamp()
      });

      const template = createReminderTemplate(employee);
      openEmailComposer({
        to: employee.email,
        subject: template.subject,
        body: template.body
      });

      showToast('Reminder marked + email preview opened.');
    } catch (error) {
      showToast(error.message);
    } finally { setLoading(false); }
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
        actionType: 'MARK_PAST_DUE',
        employeeId: employee.id,
        weekId: currentWeekId,
        details: {},
        actorUid: currentOwnerUser.uid,
        createdAt: serverTimestamp()
      });
      showToast('Marked as past due.');
    } catch (error) {
      showToast(error.message);
    } finally { setLoading(false); }
  };

  document.getElementById('markPaidBtn').onclick = async () => {
    const amount = prompt('Amount paid (example: 50.00)');
    if (!amount) return;
    const method = prompt('Payment method: Cash/Card/CashApp/Venmo/Zelle/Other', 'Cash') || 'Other';
    const notes = prompt('Notes (optional)', '') || '';
    const amountCents = Math.round(Number(amount) * 100);
    if (!Number.isFinite(amountCents) || amountCents <= 0) return showToast('Enter a valid amount.');

    try {
      setLoading(true);
      await addDoc(collection(db, 'shops', currentShopDoc.id, 'payments'), {
        employeeId: employee.id,
        weekId: currentWeekId,
        amountCents,
        method,
        paidAt: serverTimestamp(),
        notes,
        createdAt: serverTimestamp(),
        createdByUid: currentOwnerUser.uid
      });

      const statusData = await recomputeAndSetStatus(currentShopDoc.id, employee.id, employee.weeklyRentCents, statusDoc.status);
      const receipt = await createReceipt(currentShopDoc.id, employee, statusData.payments);
      const uniqueMethods = [...new Set(statusData.payments.map((payment) => payment.method))].join(', ');
      const template = createReceiptTemplate({
        employee,
        receipt,
        totalPaidCents: statusData.totalPaidCents,
        methods: uniqueMethods || method
      });

      await addDoc(collection(db, 'shops', currentShopDoc.id, 'auditLogs'), {
        actionType: 'MARK_PAID',
        employeeId: employee.id,
        weekId: currentWeekId,
        details: { amountCents, method, receiptId: receipt.id, emailPreviewGenerated: true },
        actorUid: currentOwnerUser.uid,
        createdAt: serverTimestamp()
      });

      openEmailComposer({
        to: employee.email,
        subject: template.subject,
        body: template.body,
        receiptSummary: template.summary
      });

      showToast('Payment saved + receipt preview opened.');
    } catch (error) {
      showToast(error.message);
    } finally { setLoading(false); }
  };

  const paymentSnap = await getDocs(query(
    collection(db, 'shops', currentShopDoc.id, 'payments'),
    where('employeeId', '==', employee.id),
    orderBy('createdAt', 'desc')
  ));
  const receiptSnap = await getDocs(query(
    collection(db, 'shops', currentShopDoc.id, 'receipts'),
    where('employeeId', '==', employee.id),
    orderBy('issuedAt', 'desc')
  ));
  history.innerHTML += `<p>Payments: ${paymentSnap.size}, Receipts: ${receiptSnap.size}</p>`;
}

els.ownerLoginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    setLoading(true);
    await signInWithEmailAndPassword(auth, els.ownerEmail.value, els.ownerPassword.value);
  } catch (error) {
    showToast(error.message);
  } finally { setLoading(false); }
});

els.logoutBtn.addEventListener('click', () => signOut(auth));
els.closePanel.addEventListener('click', () => els.detailsPanel.classList.add('hidden'));

els.addEmployeeForm.addEventListener('submit', async (event) => {
  event.preventDefault();
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
      employees = snap.docs.map((document) => ({ id: document.id, ...document.data() }));
      getDocs(query(collection(db, 'shops', currentShopDoc.id, 'statuses'), where('weekId', '==', currentWeekId))).then((statusSnap) => {
        const statusMap = Object.fromEntries(statusSnap.docs.map((document) => [document.id, document.data()]));
        renderEmployees(statusMap);
      });
    });
  } catch (error) {
    showToast(error.message);
    await signOut(auth);
  } finally { setLoading(false); }
});

export { buildMailtoLink, buildGmailComposeLink, copyToClipboard };
