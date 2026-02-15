import { db, serverTimestamp, Timestamp, runTransaction } from "../js/firebase.js";
import {
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  getDoc,
  onSnapshot,
  query,
  orderBy,
  where,
  limit,
  increment,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// ---------------------------
// Session guard + global state
// ---------------------------
const isLoggedIn =
  localStorage.getItem("boothrent_admin") === "true" ||
  sessionStorage.getItem("boothrent_admin") === "true";
if (!isLoggedIn) window.location.href = "../index.html";

const adminEmail = localStorage.getItem("boothrent_admin_email") || "admin@boothrent.local";

const state = {
  renters: [],
  ledgerByRenter: new Map(),
  searchText: "",
  selectedRenterId: null,
};

// ---------------------------
// DOM refs
// ---------------------------
const rentersTableBody = document.getElementById("rentersTableBody");
const totalDueValue = document.getElementById("totalDueValue");
const overdueValue = document.getElementById("overdueValue");
const paidValue = document.getElementById("paidValue");
const partialValue = document.getElementById("partialValue");
const addRenterBtn = document.getElementById("addRenterBtn");
const globalChargeBtn = document.getElementById("globalChargeBtn");
const logoutBtn = document.getElementById("logoutBtn");
const searchInput = document.getElementById("searchInput");

const drawer = document.getElementById("drawer");
const drawerTitle = document.getElementById("drawerTitle");
const drawerBody = document.getElementById("drawerBody");
const drawerCloseBtn = document.getElementById("drawerCloseBtn");

const modalOverlay = document.getElementById("modalOverlay");
const modalTitle = document.getElementById("modalTitle");
const modalBody = document.getElementById("modalBody");
const modalCloseBtn = document.getElementById("modalCloseBtn");

const toastRegion = document.getElementById("toastRegion");

// ---------------------------
// Utility helpers
// ---------------------------
const money = (cents = 0) => `$${(Number(cents) / 100).toFixed(2)}`;
const toCents = (dollars) => Math.round(Number(dollars || 0) * 100);
const safe = (value) => (value ?? "").toString();

function formatDate(value) {
  if (!value) return "-";
  const date = value.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString();
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  toastRegion.appendChild(toast);
  setTimeout(() => toast.remove(), 2800);
}

function statusFromRenter(renter) {
  if (renter.statusOverride === "ON_HOLD") return "ON_HOLD";

  const balance = Number(renter.balanceCents || 0);
  if (balance <= 0) return "PAID";

  const nextDueDate = renter.nextDueAt?.toDate ? renter.nextDueAt.toDate() : new Date(renter.nextDueAt || Date.now());
  const now = new Date();

  // PARTIAL heuristic: any payment in last 14 days + still has balance.
  const recentPayments = (state.ledgerByRenter.get(renter.id) || []).filter((entry) => {
    if (entry.type !== "payment") return false;
    const createdAt = entry.createdAt?.toDate ? entry.createdAt.toDate() : new Date(0);
    return now - createdAt <= 1000 * 60 * 60 * 24 * 14;
  });

  if (balance > 0 && recentPayments.length > 0) return "PARTIAL";
  if (balance > 0 && nextDueDate < now) return "OVERDUE";
  return "DUE";
}

function initials(name) {
  return safe(name)
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "?";
}

function getFilteredRenters() {
  const q = state.searchText.trim().toLowerCase();
  if (!q) return state.renters;
  return state.renters.filter((renter) => {
    return [renter.displayName, renter.email, renter.station].some((field) =>
      safe(field).toLowerCase().includes(q)
    );
  });
}

// ---------------------------
// Rendering
// ---------------------------
function renderSummary(filtered) {
  let totalDueCents = 0;
  let overdueCount = 0;
  let paidCount = 0;
  let partialCount = 0;

  filtered.forEach((renter) => {
    const status = statusFromRenter(renter);
    const bal = Number(renter.balanceCents || 0);
    if (bal > 0) totalDueCents += bal;
    if (status === "OVERDUE") overdueCount += 1;
    if (status === "PAID") paidCount += 1;
    if (status === "PARTIAL") partialCount += 1;
  });

  totalDueValue.textContent = money(totalDueCents);
  overdueValue.textContent = String(overdueCount);
  paidValue.textContent = String(paidCount);
  partialValue.textContent = String(partialCount);
}

function buildActionButton(text, callback) {
  const button = document.createElement("button");
  button.className = "btn";
  button.textContent = text;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    callback();
  });
  return button;
}

function renderTable() {
  const filtered = getFilteredRenters();
  renderSummary(filtered);

  rentersTableBody.innerHTML = "";
  if (filtered.length === 0) {
    rentersTableBody.innerHTML = '<div class="row">No renters found.</div>';
    return;
  }

  filtered.forEach((renter) => {
    const row = document.createElement("div");
    row.className = "row grid-row";
    row.tabIndex = 0;

    const status = statusFromRenter(renter);

    row.innerHTML = `
      <div class="renter-cell">
        <div class="avatar">${initials(renter.displayName)}</div>
        <div>
          <strong>${safe(renter.displayName)}</strong>
          <span class="subline">Station: ${safe(renter.station || "-")}</span>
        </div>
      </div>
      <div>${safe(renter.email || "-")}</div>
      <div>${money(renter.rentPlan?.amountCents || 0)}</div>
      <div>${money(renter.balanceCents || 0)}</div>
      <div>${formatDate(renter.nextDueAt)}</div>
      <div><span class="status-pill status-${status}">${status.replace("_", " ")}</span></div>
      <div class="action-group"></div>
    `;

    const actionGroup = row.querySelector(".action-group");
    actionGroup.appendChild(buildActionButton("Record Payment", () => openLedgerModal("payment", renter.id)));
    actionGroup.appendChild(buildActionButton("Send Reminder", () => openMessageModal("reminder", renter.id)));
    actionGroup.appendChild(buildActionButton("Send Receipt", () => openMessageModal("receipt", renter.id)));
    actionGroup.appendChild(buildActionButton("Edit", () => openEditRenterModal(renter)));

    row.addEventListener("click", () => openDrawer(renter.id));
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter") openDrawer(renter.id);
    });

    rentersTableBody.appendChild(row);
  });
}

function openDrawer(renterId) {
  state.selectedRenterId = renterId;
  const renter = state.renters.find((item) => item.id === renterId);
  if (!renter) return;

  drawerTitle.textContent = `${renter.displayName || "Renter"} Profile`;

  const ledgerItems = (state.ledgerByRenter.get(renter.id) || []).slice(0, 12);

  drawerBody.innerHTML = `
    <p><strong>Email:</strong> ${safe(renter.email || "-")}</p>
    <p><strong>Phone:</strong> ${safe(renter.phone || "-")}</p>
    <p><strong>Station:</strong> ${safe(renter.station || "-")}</p>
    <p><strong>Weekly Rent:</strong> ${money(renter.rentPlan?.amountCents || 0)}</p>
    <p><strong>Due Day:</strong> ${safe(renter.rentPlan?.dueDay || "-")}</p>
    <p><strong>Due Date:</strong> ${formatDate(renter.nextDueAt)}</p>
    <p><strong>Balance:</strong> ${money(renter.balanceCents || 0)}</p>
    <p><strong>Notes:</strong> ${safe(renter.notes || "-")}</p>

    <div class="action-group">
      <button class="btn" id="drawerAddCharge">Add Charge</button>
      <button class="btn" id="drawerAddFee">Add Late Fee</button>
      <button class="btn" id="drawerApplyCredit">Apply Credit</button>
      <button class="btn" id="drawerRecordPayment">Record Payment</button>
    </div>

    <div class="timeline">
      <h3>Activity Timeline</h3>
      ${
        ledgerItems.length
          ? ledgerItems
              .map(
                (entry) => `
        <div class="timeline-item">
          <strong>${entry.type.toUpperCase()}</strong> · ${money(entry.amountCents)}<br />
          <span class="subline">${formatDate(entry.effectiveAt || entry.createdAt)} | ${safe(entry.note || "No note")}</span>
        </div>`
              )
              .join("")
          : "<p class='subline'>No activity yet.</p>"
      }
    </div>
  `;

  drawer.classList.add("open");
  drawer.setAttribute("aria-hidden", "false");

  document.getElementById("drawerAddCharge")?.addEventListener("click", () => openLedgerModal("charge", renter.id));
  document.getElementById("drawerAddFee")?.addEventListener("click", () => openLedgerModal("fee", renter.id));
  document.getElementById("drawerApplyCredit")?.addEventListener("click", () => openLedgerModal("credit", renter.id));
  document.getElementById("drawerRecordPayment")?.addEventListener("click", () => openLedgerModal("payment", renter.id));
}

function closeDrawer() {
  drawer.classList.remove("open");
  drawer.setAttribute("aria-hidden", "true");
}

// ---------------------------
// Generic modal helpers
// ---------------------------
let lastFocusedElement = null;

function openModal(title, html, onMount) {
  lastFocusedElement = document.activeElement;
  modalTitle.textContent = title;
  modalBody.innerHTML = html;
  modalOverlay.classList.remove("hidden");
  const firstInput = modalBody.querySelector("input, textarea, select, button");
  if (firstInput) firstInput.focus();
  if (typeof onMount === "function") onMount();
}

function closeModal() {
  modalOverlay.classList.add("hidden");
  modalBody.innerHTML = "";
  if (lastFocusedElement) lastFocusedElement.focus();
}

// ---------------------------
// Firestore write operations
// ---------------------------
async function adjustBalanceWithLedger({ renterId, type, amountCents, note = "", method = "" }) {
  const amount = Number(amountCents);
  if (!renterId || !amount || amount <= 0) return;

  const multiplier = type === "payment" || type === "credit" ? -1 : 1;

  await runTransaction(db, async (transaction) => {
    const renterRef = doc(db, "renters", renterId);
    const renterSnap = await transaction.get(renterRef);
    if (!renterSnap.exists()) throw new Error("Renter not found");

    const ledgerRef = doc(collection(db, "ledger"));
    transaction.set(ledgerRef, {
      renterId,
      type,
      amountCents: amount,
      createdAt: serverTimestamp(),
      effectiveAt: Timestamp.now(),
      note,
      meta: method ? { method } : {},
    });

    transaction.update(renterRef, {
      balanceCents: increment(multiplier * amount),
      updatedAt: serverTimestamp(),
    });
  });
}

// ---------------------------
// Feature modals
// ---------------------------
function openAddRenterModal() {
  openModal(
    "Add Renter",
    `
    <form id="addRenterForm" class="form-grid">
      <div><label for="name">Name</label><input id="name" required /></div>
      <div><label for="email">Email</label><input id="email" type="email" required /></div>
      <div><label for="station">Station</label><input id="station" /></div>
      <div><label for="rentAmount">Weekly Rent ($)</label><input id="rentAmount" type="number" min="0" step="0.01" required /></div>
      <div><label for="dueDate">Due Date</label><input id="dueDate" type="date" required /></div>
      <div><label for="dueDay">Due Day</label><input id="dueDay" placeholder="Tuesday" required /></div>
      <div class="full"><label for="notes">Notes</label><textarea id="notes"></textarea></div>
      <div class="modal-actions full">
        <button type="button" class="btn" id="cancelAdd">Cancel</button>
        <button class="btn accent" type="submit">Save Renter</button>
      </div>
    </form>
  `,
    () => {
      document.getElementById("cancelAdd").addEventListener("click", closeModal);
      document.getElementById("addRenterForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const dueDate = new Date(form.querySelector("#dueDate").value);

        const newRenterRef = doc(collection(db, "renters"));
        await setDoc(newRenterRef, {
          displayName: form.querySelector("#name").value.trim(),
          email: form.querySelector("#email").value.trim(),
          phone: "",
          station: form.querySelector("#station").value.trim(),
          photoUrl: "",
          active: true,
          rentPlan: {
            cadence: "weekly",
            amountCents: toCents(form.querySelector("#rentAmount").value),
            dueDay: form.querySelector("#dueDay").value.trim(),
          },
          balanceCents: 0,
          nextDueAt: Timestamp.fromDate(dueDate),
          statusOverride: null,
          notes: form.querySelector("#notes").value.trim(),
          updatedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        });

        closeModal();
        showToast("Renter saved");
      });
    }
  );
}

function openEditRenterModal(renter) {
  openModal(
    "Edit Renter",
    `
    <form id="editRenterForm" class="form-grid">
      <div><label for="name">Name</label><input id="name" value="${safe(renter.displayName)}" required /></div>
      <div><label for="email">Email</label><input id="email" value="${safe(renter.email)}" type="email" required /></div>
      <div><label for="station">Station</label><input id="station" value="${safe(renter.station)}" /></div>
      <div><label for="rentAmount">Weekly Rent ($)</label><input id="rentAmount" type="number" min="0" step="0.01" value="${((renter.rentPlan?.amountCents || 0) / 100).toFixed(2)}" required /></div>
      <div><label for="dueDate">Due Date</label><input id="dueDate" type="date" value="${new Date(renter.nextDueAt?.toDate?.() || Date.now()).toISOString().slice(0, 10)}" required /></div>
      <div><label for="dueDay">Due Day</label><input id="dueDay" value="${safe(renter.rentPlan?.dueDay)}" required /></div>
      <div>
        <label for="statusOverride">Override Status</label>
        <select id="statusOverride">
          <option value="">Normal</option>
          <option value="ON_HOLD" ${renter.statusOverride === "ON_HOLD" ? "selected" : ""}>On Hold</option>
        </select>
      </div>
      <div class="full"><label for="notes">Notes</label><textarea id="notes">${safe(renter.notes)}</textarea></div>
      <div class="modal-actions full">
        <button type="button" class="btn" id="cancelEdit">Cancel</button>
        <button class="btn accent" type="submit">Update Renter</button>
      </div>
    </form>
  `,
    () => {
      document.getElementById("cancelEdit").addEventListener("click", closeModal);
      document.getElementById("editRenterForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        const form = e.currentTarget;

        await updateDoc(doc(db, "renters", renter.id), {
          displayName: form.querySelector("#name").value.trim(),
          email: form.querySelector("#email").value.trim(),
          station: form.querySelector("#station").value.trim(),
          rentPlan: {
            cadence: "weekly",
            amountCents: toCents(form.querySelector("#rentAmount").value),
            dueDay: form.querySelector("#dueDay").value.trim(),
          },
          nextDueAt: Timestamp.fromDate(new Date(form.querySelector("#dueDate").value)),
          statusOverride: form.querySelector("#statusOverride").value || null,
          notes: form.querySelector("#notes").value.trim(),
          updatedAt: serverTimestamp(),
        });

        closeModal();
        showToast("Renter updated");
      });
    }
  );
}

function openLedgerModal(type, renterId = "") {
  const renterOptions = state.renters
    .map((r) => `<option value="${r.id}" ${r.id === renterId ? "selected" : ""}>${safe(r.displayName)} (${safe(r.email)})</option>`)
    .join("");

  const typeLabel = type.charAt(0).toUpperCase() + type.slice(1);

  openModal(
    `${typeLabel} Entry`,
    `
    <form id="ledgerForm" class="form-grid">
      <div class="full">
        <label for="renterId">Renter</label>
        <select id="renterId" required>${renterOptions}</select>
      </div>
      <div><label for="amount">Amount ($)</label><input id="amount" type="number" min="0.01" step="0.01" required /></div>
      <div><label for="method">Method</label><input id="method" placeholder="cash/card/zelle (for payments)" /></div>
      <div class="full"><label for="note">Note</label><textarea id="note"></textarea></div>
      <div class="modal-actions full">
        <button type="button" class="btn" id="cancelLedger">Cancel</button>
        <button class="btn accent" type="submit">Save ${typeLabel}</button>
      </div>
    </form>
  `,
    () => {
      document.getElementById("cancelLedger").addEventListener("click", closeModal);
      document.getElementById("ledgerForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        await adjustBalanceWithLedger({
          renterId: form.querySelector("#renterId").value,
          type,
          amountCents: toCents(form.querySelector("#amount").value),
          note: form.querySelector("#note").value.trim(),
          method: form.querySelector("#method").value.trim(),
        });

        closeModal();
        showToast(`${typeLabel} recorded`);
      });
    }
  );
}

function fillTemplate(template, vars) {
  return template.replace(/{{\s*(\w+)\s*}}/g, (_, key) => safe(vars[key] ?? ""));
}

function openMessageModal(kind, renterId) {
  const renter = state.renters.find((r) => r.id === renterId);
  if (!renter) return;

  const lastPayment = (state.ledgerByRenter.get(renter.id) || []).find((x) => x.type === "payment");

  const variables = {
    renterName: renter.displayName,
    amountDue: money(renter.balanceCents || 0),
    dueDate: formatDate(renter.nextDueAt),
    station: renter.station || "N/A",
    shopName: "BoothRent Pro",
    paymentAmount: lastPayment ? money(lastPayment.amountCents) : "$0.00",
    paymentDate: lastPayment ? formatDate(lastPayment.createdAt) : "N/A",
  };

  const reminderBody = `Hi {{renterName}},\n\nThis is a reminder that your current balance is {{amountDue}} and due date is {{dueDate}} for station {{station}} at {{shopName}}.\n\nThank you.`;
  const receiptBody = `Hi {{renterName}},\n\nThank you for your payment of {{paymentAmount}} on {{paymentDate}}.\nCurrent balance: {{amountDue}}.\n\n- {{shopName}}`;

  const subject = kind === "reminder" ? `Rent Reminder - ${variables.shopName}` : `Payment Receipt - ${variables.shopName}`;
  const body = fillTemplate(kind === "reminder" ? reminderBody : receiptBody, variables);

  openModal(
    kind === "reminder" ? "Send Reminder" : "Send Receipt",
    `
    <form id="messageForm" class="form-grid">
      <div><label for="toEmail">To</label><input id="toEmail" value="${safe(renter.email)}" required /></div>
      <div><label for="subject">Subject</label><input id="subject" value="${safe(subject)}" required /></div>
      <div class="full"><label for="body">Body</label><textarea id="body">${safe(body)}</textarea></div>
      ${
        kind === "receipt"
          ? `<div class="full"><div id="printReceipt" class="timeline-item"><strong>Printable Receipt</strong><p>Renter: ${safe(
              renter.displayName
            )}</p><p>Last Payment: ${variables.paymentAmount} on ${variables.paymentDate}</p><p>Current Balance: ${variables.amountDue}</p></div></div>`
          : ""
      }
      <div class="modal-actions full">
        <button type="button" class="btn" id="copyMessage">Copy</button>
        <button type="button" class="btn" id="openMailClient">Open Email Client</button>
        ${kind === "receipt" ? '<button type="button" class="btn" id="printBtn">Print</button>' : ""}
        <button type="button" class="btn" id="saveDraft">Save Draft</button>
        <button type="button" class="btn accent" id="markSent">Mark Sent</button>
      </div>
    </form>
  `,
    () => {
      const getPayload = () => ({
        renterId: renter.id,
        kind,
        toEmail: document.getElementById("toEmail").value.trim(),
        subject: document.getElementById("subject").value.trim(),
        body: document.getElementById("body").value,
      });

      document.getElementById("copyMessage").addEventListener("click", async () => {
        await navigator.clipboard.writeText(document.getElementById("body").value);
        showToast("Message copied");
      });

      document.getElementById("openMailClient").addEventListener("click", () => {
        const payload = getPayload();
        const url = `mailto:${encodeURIComponent(payload.toEmail)}?subject=${encodeURIComponent(
          payload.subject
        )}&body=${encodeURIComponent(payload.body)}`;
        window.open(url, "_blank");
      });

      if (kind === "receipt") {
        document.getElementById("printBtn").addEventListener("click", () => {
          const printable = document.getElementById("printReceipt")?.innerHTML || "";
          const win = window.open("", "_blank");
          win.document.write(`<html><body>${printable}</body></html>`);
          win.document.close();
          win.print();
        });
      }

      document.getElementById("saveDraft").addEventListener("click", async () => {
        const payload = getPayload();
        await addDoc(collection(db, "messages"), {
          ...payload,
          createdAt: serverTimestamp(),
          sentAt: null,
          sentBy: adminEmail,
          status: "draft",
        });
        closeModal();
        showToast(`${kind === "reminder" ? "Reminder" : "Receipt"} saved`);
      });

      document.getElementById("markSent").addEventListener("click", async () => {
        const payload = getPayload();
        await addDoc(collection(db, "messages"), {
          ...payload,
          createdAt: serverTimestamp(),
          sentAt: Timestamp.now(),
          sentBy: adminEmail,
          status: "sent",
        });
        closeModal();
        showToast(`${kind === "reminder" ? "Reminder" : "Receipt"} logged as sent`);
      });
    }
  );
}

// ---------------------------
// Realtime listeners
// ---------------------------
function setupRealtimeListeners() {
  onSnapshot(query(collection(db, "renters"), orderBy("updatedAt", "desc")), (snapshot) => {
    state.renters = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderTable();

    // If drawer is open for one renter, re-render it immediately on changes.
    if (state.selectedRenterId && drawer.classList.contains("open")) {
      openDrawer(state.selectedRenterId);
    }
  });

  // Keep light: last 500 ledger entries, sorted newest first.
  onSnapshot(query(collection(db, "ledger"), orderBy("createdAt", "desc"), limit(500)), (snapshot) => {
    const ledgerByRenter = new Map();
    snapshot.docs.forEach((docSnap) => {
      const entry = { id: docSnap.id, ...docSnap.data() };
      const arr = ledgerByRenter.get(entry.renterId) || [];
      arr.push(entry);
      ledgerByRenter.set(entry.renterId, arr);
    });

    state.ledgerByRenter = ledgerByRenter;
    renderTable();
    if (state.selectedRenterId && drawer.classList.contains("open")) openDrawer(state.selectedRenterId);
  });
}

// ---------------------------
// App events
// ---------------------------
searchInput.addEventListener("input", (e) => {
  state.searchText = e.target.value;
  renderTable();
});

addRenterBtn.addEventListener("click", openAddRenterModal);
globalChargeBtn.addEventListener("click", () => openLedgerModal("charge"));

logoutBtn.addEventListener("click", () => {
  localStorage.removeItem("boothrent_admin");
  sessionStorage.removeItem("boothrent_admin");
  localStorage.removeItem("boothrent_admin_email");
  window.location.href = "../index.html";
});

drawerCloseBtn.addEventListener("click", closeDrawer);
modalCloseBtn.addEventListener("click", closeModal);
modalOverlay.addEventListener("click", (e) => {
  if (e.target === modalOverlay) closeModal();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeModal();
    closeDrawer();
  }
});

setupRealtimeListeners();
