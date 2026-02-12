import { auth, db, functions } from './firebase-config.js';
import {
  isSignInWithEmailLink,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  signOut
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  where
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js';

const actionCodeSettings = {
  url: `${window.location.origin}${window.location.pathname}`,
  handleCodeInApp: true
};

const els = {
  staffLoginCard: document.getElementById('staffLoginCard'),
  sendLinkForm: document.getElementById('sendLinkForm'),
  staffEmail: document.getElementById('staffEmail'),
  staffDashboard: document.getElementById('staffDashboard'),
  staffAuthEmail: document.getElementById('staffAuthEmail'),
  staffLogoutBtn: document.getElementById('staffLogoutBtn'),
  staffWelcome: document.getElementById('staffWelcome'),
  staffStatus: document.getElementById('staffStatus'),
  receiptList: document.getElementById('receiptList'),
  paymentList: document.getElementById('paymentList'),
  staffLoading: document.getElementById('staffLoading'),
  staffToast: document.getElementById('staffToast')
};

function showToast(msg) {
  els.staffToast.textContent = msg;
  els.staffToast.classList.remove('hidden');
  setTimeout(() => els.staffToast.classList.add('hidden'), 2600);
}
function setLoading(v) { els.staffLoading.classList.toggle('hidden', !v); }
const centsToUsd = (c) => `$${(c / 100).toFixed(2)}`;


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


async function completeEmailLinkIfNeeded() {
  if (!isSignInWithEmailLink(auth, window.location.href)) return;
  let email = window.localStorage.getItem('staffEmailForSignIn');
  if (!email) {
    showToast('Please enter your email in the form first, then open the sign-in link again.');
    return;
  }
  await signInWithEmailLink(auth, email, window.location.href);
  window.localStorage.removeItem('staffEmailForSignIn');
  showToast('Signed in successfully.');
}

els.sendLinkForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    setLoading(true);
    const email = els.staffEmail.value.trim().toLowerCase();
    await sendSignInLinkToEmail(auth, email, actionCodeSettings);
    window.localStorage.setItem('staffEmailForSignIn', email);
    showToast('Sign-in link sent. Check your email inbox.');
  } catch (error) {
    showToast(error.message);
  } finally { setLoading(false); }
});

els.staffLogoutBtn.addEventListener('click', () => signOut(auth));

async function claimInviteIfPresent() {
  const params = new URLSearchParams(window.location.search);
  const inviteId = params.get('invite');
  if (!inviteId) return;
  await httpsCallable(functions, 'claimInvite')({ inviteId });
  showToast('Invite claimed. Your staff account is linked.');
  const cleanUrl = new URL(window.location.href);
  cleanUrl.searchParams.delete('invite');
  window.history.replaceState({}, '', cleanUrl);
}

async function loadStaffData(user) {
  const userSnap = await getDoc(doc(db, 'users', user.uid));
  if (!userSnap.exists()) throw new Error('No user profile found. Ask owner to invite you.');
  const userDoc = userSnap.data();
  if (userDoc.role !== 'staff') throw new Error('Not a staff account.');

  const employeeSnap = await getDoc(doc(db, 'shops', userDoc.shopId, 'employees', userDoc.employeeId));
  if (!employeeSnap.exists()) throw new Error('Employee profile missing.');
  const employee = employeeSnap.data();
  const weekId = new Date().toISOString().slice(0, 10);
  const statusSnap = await getDoc(doc(db, 'shops', userDoc.shopId, 'statuses', `${userDoc.employeeId}_${weekId}`));
  const status = statusSnap.exists() ? statusSnap.data() : { status: 'PAST_DUE', totalPaidCents: 0 };

  els.staffWelcome.textContent = `Hi ${employee.name}`;
  els.staffStatus.textContent = `Current status: ${status.status} | Paid ${centsToUsd(status.totalPaidCents || 0)} / ${centsToUsd(employee.weeklyRentCents || 0)}`;

  const receiptsSnap = await getDocs(query(collection(db, 'shops', userDoc.shopId, 'receipts'), where('employeeId', '==', userDoc.employeeId), orderBy('issuedAt', 'desc')));
  els.receiptList.innerHTML = '';
  receiptsSnap.forEach((d) => {
    const r = d.data();
    const li = document.createElement('li');
    li.textContent = `${r.receiptNumber} — ${centsToUsd(r.totalCents)}`;
    els.receiptList.appendChild(li);
  });

  const paymentsSnap = await getDocs(query(collection(db, 'shops', userDoc.shopId, 'payments'), where('employeeId', '==', userDoc.employeeId), orderBy('createdAt', 'desc')));
  els.paymentList.innerHTML = '';
  paymentsSnap.forEach((d) => {
    const p = d.data();
    const li = document.createElement('li');
    li.textContent = `${centsToUsd(p.amountCents)} via ${p.method}`;
    els.paymentList.appendChild(li);
  });
}

(async () => {
  try {
    setLoading(true);
    await completeEmailLinkIfNeeded();
  } catch (e) {
    showToast(e.message);
  } finally { setLoading(false); }
})();

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    els.staffLoginCard.classList.remove('hidden');
    els.staffDashboard.classList.add('hidden');
    els.staffLogoutBtn.classList.add('hidden');
    els.staffAuthEmail.textContent = '';
    return;
  }
  try {
    setLoading(true);
    await claimInviteIfPresent();
    await loadStaffData(user);
    els.staffLoginCard.classList.add('hidden');
    els.staffDashboard.classList.remove('hidden');
    els.staffLogoutBtn.classList.remove('hidden');
    els.staffAuthEmail.textContent = user.email;
  } catch (error) {
    showToast(error.message);
  } finally { setLoading(false); }
});
