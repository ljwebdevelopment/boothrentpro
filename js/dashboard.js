import { db, serverTimestamp, Timestamp, runTransaction } from "../js/firebase.js";
import {
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  query,
  orderBy,
  limit,
  increment,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const isLoggedIn =
  localStorage.getItem("boothrent_admin") === "true" ||
  sessionStorage.getItem("boothrent_admin") === "true";
if (!isLoggedIn) window.location.href = "/html/login.html";

const adminEmail = localStorage.getItem("boothrent_admin_email") || "admin@boothrent.local";
const adminUid =
  localStorage.getItem("boothrent_admin_uid") ||
  `admin_${btoa(adminEmail).replace(/[^a-zA-Z0-9]/g, "").slice(0, 24)}`;

const THEME_COLOR_PALETTE = ["#7c3aed", "#2563eb", "#0f766e", "#b45309", "#be123c", "#374151", "#166534", "#4338ca"];

const PROFILE_COLOR_PALETTE = [
  "#7c3aed",
  "#2563eb",
  "#0f766e",
  "#b45309",
  "#be123c",
  "#374151",
  "#166534",
  "#4338ca",
];

const state = {
  renters: [],
  ledgerByRenter: new Map(),
  historyItems: [],
  searchText: "",
  selectedRenterId: null,
  businessProfile: null,
};

const rentersTableBody = document.getElementById("rentersTableBody");
const totalDueValue = document.getElementById("totalDueValue");
const overdueValue = document.getElementById("overdueValue");
const paidValue = document.getElementById("paidValue");
const partialValue = document.getElementById("partialValue");
const addRenterBtn = document.getElementById("addRenterBtn");
const globalChargeBtn = document.getElementById("globalChargeBtn");
const historyBtn = document.getElementById("historyBtn");
const logoutBtn = document.getElementById("logoutBtn");
const searchInput = document.getElementById("searchInput");
const backToTopBtn = document.getElementById("backToTopBtn");
const mobileBottomNav = document.getElementById("mobileBottomNav");

const drawer = document.getElementById("drawer");
const drawerTitle = document.getElementById("drawerTitle");
const drawerBody = document.getElementById("drawerBody");
const drawerCloseBtn = document.getElementById("drawerCloseBtn");

const modalOverlay = document.getElementById("modalOverlay");
const modalTitle = document.getElementById("modalTitle");
const modalBody = document.getElementById("modalBody");
const modalCloseBtn = document.getElementById("modalCloseBtn");

const toastRegion = document.getElementById("toastRegion");

const money = (cents = 0) => `$${(Number(cents) / 100).toFixed(2)}`;
const toCents = (dollars) => Math.round(Number(dollars || 0) * 100);
const safe = (value) => (value ?? "").toString();
const truncate = (value, max = 180) => {
  const text = safe(value).trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
};

function formatDate(value) {
  if (!value) return "-";
  const date = value.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString();
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = value.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function colorTextForBackground(hexColor) {
  const value = safe(hexColor).replace("#", "");
  if (value.length !== 6) return "#ffffff";
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.65 ? "#0f172a" : "#ffffff";
}

function pickRandomProfileColor() {
  return PROFILE_COLOR_PALETTE[Math.floor(Math.random() * PROFILE_COLOR_PALETTE.length)];
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  toastRegion.appendChild(toast);
  setTimeout(() => toast.remove(), 2800);
}

function statusFromRenter(renter) {
  if (renter.status === "deleted") return "ON_HOLD";
  if (renter.statusOverride === "ON_HOLD") return "ON_HOLD";

  const balance = Number(renter.balanceCents || 0);
  if (balance <= 0) return "PAID";

  const nextDueDate = renter.nextDueAt?.toDate ? renter.nextDueAt.toDate() : new Date(renter.nextDueAt || Date.now());
  const now = new Date();

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

function getActiveRenters() {
  return state.renters.filter((renter) => renter.status !== "deleted");
}

function getFilteredRenters() {
  const q = state.searchText.trim().toLowerCase();
  const base = getActiveRenters();
  if (!q) return base;
  return base.filter((renter) => {
    return [renter.displayName, renter.email, renter.station].some((field) => safe(field).toLowerCase().includes(q));
  });
}

function buildEmailMessage(renter) {
  const amountDue = money(renter.balanceCents || 0);
  const dueDate = formatDate(renter.nextDueAt);
  const chargeLabel = renter.rentPlan?.cadence === "weekly" ? "booth rent" : "charge";
  const subject = "Booth Rent Pro – Payment Reminder";
  const body = [
    `Hi ${safe(renter.displayName)},`,
    "",
    "This is a payment reminder from Booth Rent Pro.",
    `Amount due: ${amountDue}`,
    `Due date: ${dueDate}`,
    `For: ${chargeLabel}${renter.station ? ` (station ${safe(renter.station)})` : ""}`,
    "",
    "Please submit your payment using your usual method (cash/card/Zelle) and reply if you have any questions.",
    "",
    "Thank you,",
    "Booth Rent Pro",
  ].join("\n");

  const preview = truncate(body.replace(/\n+/g, " "));
  const messageHash = btoa(unescape(encodeURIComponent(`${subject}|${body}`))).slice(0, 40);

  return {
    toEmail: safe(renter.email),
    subject,
    body,
    preview,
    messageHash,
  };
}

async function addHistoryEvent({ actionType, renterId = "", renterName = "", amountCents = 0, summary, metadata = {} }) {
  await addDoc(collection(db, "history"), {
    actionType,
    renterId,
    renterName,
    amountCents,
    summary,
    actor: adminEmail,
    createdAt: serverTimestamp(),
    metadata,
  });
}

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

function buildActionButton(text, callback, className = "btn") {
  const button = document.createElement("button");
  button.className = className;
  button.textContent = text;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    callback();
  });
  return button;
}

function renterThemeColor(renter) {
  return renter.themeColor || renter.profileColor || "#7c3aed";
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
    row.className = "row grid-row themed-row";
    row.tabIndex = 0;

    const status = statusFromRenter(renter);
    const profileColor = renter.profileColor || "#7c3aed";
    const profileTextColor = colorTextForBackground(profileColor);

    row.innerHTML = `
      <div class="renter-cell">
        <div class="avatar" style="background:${profileColor};color:${profileTextColor};">${initials(renter.displayName)}</div>
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
    actionGroup.appendChild(buildActionButton("Email", () => openEmailOptionsModal(renter.id)));
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
  const accent = renter.profileColor || "#7c3aed";

  drawerBody.innerHTML = `
    <div class="profile-accent" style="background:${accent};"></div>
    <p><strong>Email:</strong> ${safe(renter.email || "-")}</p>
    <p><strong>Phone:</strong> ${safe(renter.phone || "-")}</p>
    <p><strong>Station:</strong> ${safe(renter.station || "-")}</p>
    <p><strong>Weekly Rent:</strong> ${money(renter.rentPlan?.amountCents || 0)}</p>
    <p><strong>Due Day:</strong> ${safe(renter.rentPlan?.dueDay || "-")}</p>
    <p><strong>Due Date:</strong> ${formatDate(renter.nextDueAt)}</p>
    <p><strong>Balance:</strong> ${money(renter.balanceCents || 0)}</p>
    <p><strong>Last emailed:</strong> ${formatDateTime(renter.emailLastSentAt)}</p>
    <p><strong>Notes:</strong> ${safe(renter.notes || "-")}</p>

    <div class="action-group">
      <button class="btn" id="drawerAddCharge">Add Charge</button>
      <button class="btn" id="drawerAddFee">Add Late Fee</button>
      <button class="btn" id="drawerEmail">Email</button>
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
          <span class="subline">${formatDateTime(entry.effectiveAt || entry.createdAt)} | ${safe(entry.note || "No note")}</span>
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
  document.getElementById("drawerEmail")?.addEventListener("click", () => openEmailOptionsModal(renter.id));
  document.getElementById("drawerRecordPayment")?.addEventListener("click", () => openLedgerModal("payment", renter.id));
}

function closeDrawer() {
  drawer.classList.remove("open");
  drawer.setAttribute("aria-hidden", "true");
}

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

async function adjustBalanceWithLedger({ renterId, type, amountCents, note = "", method = "", renterNameSnapshot = "" }) {
  const amount = Number(amountCents);
  if (!renterId || !amount || amount <= 0) return;

  const multiplier = type === "payment" ? -1 : 1;

  await runTransaction(db, async (transaction) => {
    const renterRef = doc(db, "renters", renterId);
    const renterSnap = await transaction.get(renterRef);
    if (!renterSnap.exists()) throw new Error("Renter not found");

    const ledgerRef = doc(collection(db, "ledger"));
    transaction.set(ledgerRef, {
      ownerUid: adminUid,
      renterId,
      renterNameSnapshot: renterNameSnapshot || renterSnap.data().displayName || "Unknown renter",
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

function openAddRenterModal() {
  const colorOptions = PROFILE_COLOR_PALETTE.map((color) => `<option value="${color}">${color}</option>`).join("");

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
      <div><label for="profileColor">Profile Color</label><select id="profileColor">${colorOptions}</select></div>
      <div class="full"><label for="notes">Notes</label><textarea id="notes"></textarea></div>
      <div class="modal-actions full">
        <button type="button" class="btn" id="cancelAdd">Cancel</button>
        <button class="btn accent" type="submit">Save Renter</button>
      </div>
    </form>
  `,
    () => {
      const randomColor = pickRandomProfileColor();
      document.getElementById("profileColor").value = randomColor;

      document.getElementById("cancelAdd").addEventListener("click", closeModal);
      document.getElementById("addRenterForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const dueDate = new Date(form.querySelector("#dueDate").value);

        const newRenterRef = doc(collection(db, "renters"));
        const displayName = form.querySelector("#name").value.trim();
        await setDoc(newRenterRef, {
          displayName,
          email: form.querySelector("#email").value.trim(),
          phone: "",
          station: form.querySelector("#station").value.trim(),
          photoUrl: "",
          active: true,
          status: "active",
          rentPlan: {
            cadence: "weekly",
            amountCents: toCents(form.querySelector("#rentAmount").value),
            dueDay: form.querySelector("#dueDay").value.trim(),
          },
          profileColor: form.querySelector("#profileColor").value,
          balanceCents: 0,
          nextDueAt: Timestamp.fromDate(dueDate),
          statusOverride: null,
          notes: form.querySelector("#notes").value.trim(),
          emailLastSentAt: null,
          emailLastSentBy: "",
          emailLastMessagePreview: "",
          updatedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        });

        await addHistoryEvent({
          actionType: "renter_created",
          renterId: newRenterRef.id,
          renterName: displayName,
          summary: `Renter created: ${displayName}`,
        });

        closeModal();
        showToast("Renter saved");
      });
    }
  );
}

function openEditRenterModal(renter) {
  const colorOptions = PROFILE_COLOR_PALETTE.map(
    (color) => `<option value="${color}" ${renter.profileColor === color ? "selected" : ""}>${color}</option>`
  ).join("");

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
      <div><label for="profileColor">Profile Color</label><select id="profileColor">${colorOptions}</select></div>
      <div>
        <label for="statusOverride">Override Status</label>
        <select id="statusOverride">
          <option value="">Normal</option>
          <option value="ON_HOLD" ${renter.statusOverride === "ON_HOLD" ? "selected" : ""}>On Hold</option>
        </select>
      </div>
      <div class="full"><label for="notes">Notes</label><textarea id="notes">${safe(renter.notes)}</textarea></div>
      <div class="full danger-zone">
        <h3>Danger Zone</h3>
        <p class="subline">Soft delete hides this renter from active lists but keeps charges/history.</p>
        <label for="deleteConfirmText">Type DELETE to enable delete</label>
        <input id="deleteConfirmText" placeholder="DELETE" />
        <button type="button" class="btn danger" id="deleteRenterBtn" disabled>Delete renter</button>
      </div>
      <div class="modal-actions full">
        <button type="button" class="btn" id="cancelEdit">Cancel</button>
        <button class="btn accent" type="submit">Update Renter</button>
      </div>
    </form>
  `,
    () => {
      document.getElementById("cancelEdit").addEventListener("click", closeModal);

      const deleteConfirmText = document.getElementById("deleteConfirmText");
      const deleteBtn = document.getElementById("deleteRenterBtn");
      deleteConfirmText.addEventListener("input", () => {
        deleteBtn.disabled = deleteConfirmText.value.trim() !== "DELETE";
      });

      deleteBtn.addEventListener("click", async () => {
        await updateDoc(doc(db, "renters", renter.id), {
          status: "deleted",
          deletedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        await addHistoryEvent({
          actionType: "renter_deleted",
          renterId: renter.id,
          renterName: renter.displayName,
          summary: `Renter deleted: ${renter.displayName}`,
        });

        closeModal();
        closeDrawer();
        showToast("Renter deleted (soft delete)");
      });

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
          profileColor: form.querySelector("#profileColor").value,
          nextDueAt: Timestamp.fromDate(new Date(form.querySelector("#dueDate").value)),
          statusOverride: form.querySelector("#statusOverride").value || null,
          notes: form.querySelector("#notes").value.trim(),
          updatedAt: serverTimestamp(),
        });

        await addHistoryEvent({
          actionType: "renter_edited",
          renterId: renter.id,
          renterName: form.querySelector("#name").value.trim(),
          summary: `Renter updated: ${form.querySelector("#name").value.trim()}`,
        });

        closeModal();
        showToast("Renter updated");
      });
    }
  );
}

function openLedgerModal(type, renterId = "") {
  const renterOptions = getActiveRenters()
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
        const selectedRenterId = form.querySelector("#renterId").value;
        const renter = state.renters.find((item) => item.id === selectedRenterId);
        const amountCents = toCents(form.querySelector("#amount").value);

        await adjustBalanceWithLedger({
          renterId: selectedRenterId,
          type,
          amountCents,
          note: form.querySelector("#note").value.trim(),
          method: form.querySelector("#method").value.trim(),
          renterNameSnapshot: renter?.displayName || "Unknown renter",
        });

        await addHistoryEvent({
          actionType: type === "payment" ? "payment_recorded" : "charge_created",
          renterId: selectedRenterId,
          renterName: renter?.displayName || "Unknown renter",
          amountCents,
          summary: `${typeLabel} recorded for ${renter?.displayName || "renter"}`,
        });

        closeModal();
        showToast(`${typeLabel} recorded`);
      });
    }
  );
}

function openCreateChargeModal() {
  const renters = getActiveRenters();
  openModal(
    "Create Charge (Multiple Renters)",
    `
    <form id="multiChargeForm" class="form-grid">
      <div><label for="chargeAmount">Amount ($)</label><input id="chargeAmount" type="number" min="0.01" step="0.01" required /></div>
      <div><label for="chargeNote">Charge label</label><input id="chargeNote" placeholder="Booth rent" /></div>
      <div class="full">
        <label for="renterFilterInput">Search renters</label>
        <input id="renterFilterInput" placeholder="Type a renter name, email, or station" />
      </div>
      <div class="full">
        <button type="button" class="btn" id="selectAllFilteredBtn">Select all (filtered)</button>
      </div>
      <div class="full renter-multi-list" id="renterCheckboxList"></div>
      <p class="full subline" id="multiChargeSelectionSummary">0 renters selected</p>
      <div class="modal-actions full">
        <button type="button" class="btn" id="cancelMultiCharge">Cancel</button>
        <button type="submit" class="btn accent">Create Charges</button>
      </div>
      <div class="full" id="multiChargeResult"></div>
    </form>
  `,
    () => {
      const selection = new Set();
      const listElement = document.getElementById("renterCheckboxList");
      const filterInput = document.getElementById("renterFilterInput");
      const summaryElement = document.getElementById("multiChargeSelectionSummary");

      const renderCheckboxes = () => {
        const q = filterInput.value.trim().toLowerCase();
        const filtered = renters.filter((renter) =>
          [renter.displayName, renter.email, renter.station].some((value) => safe(value).toLowerCase().includes(q))
        );

        listElement.innerHTML = filtered
          .map(
            (renter) => `
            <label class="renter-checkbox-row">
              <input type="checkbox" data-renter-id="${renter.id}" ${selection.has(renter.id) ? "checked" : ""} />
              <span>${safe(renter.displayName)} (${safe(renter.email || "no email")})</span>
            </label>
          `
          )
          .join("");

        listElement.querySelectorAll("input[type='checkbox']").forEach((checkbox) => {
          checkbox.addEventListener("change", () => {
            const id = checkbox.getAttribute("data-renter-id");
            if (checkbox.checked) selection.add(id);
            else selection.delete(id);
            summaryElement.textContent = `${selection.size} renters selected`;
          });
        });

        summaryElement.textContent = `${selection.size} renters selected`;
      };

      document.getElementById("cancelMultiCharge").addEventListener("click", closeModal);
      filterInput.addEventListener("input", renderCheckboxes);

      document.getElementById("selectAllFilteredBtn").addEventListener("click", () => {
        const q = filterInput.value.trim().toLowerCase();
        renters.forEach((renter) => {
          const matches = [renter.displayName, renter.email, renter.station].some((value) => safe(value).toLowerCase().includes(q));
          if (matches) selection.add(renter.id);
        });
        renderCheckboxes();
      });

      document.getElementById("multiChargeForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        const amountCents = toCents(document.getElementById("chargeAmount").value);
        const note = document.getElementById("chargeNote").value.trim() || "Charge";
        const resultElement = document.getElementById("multiChargeResult");
        if (!selection.size) {
          resultElement.innerHTML = '<p class="subline">Please select at least one renter.</p>';
          return;
        }

        let successCount = 0;
        let failedCount = 0;
        const failures = [];

        for (const renterId of selection) {
          const renter = state.renters.find((item) => item.id === renterId);
          try {
            await adjustBalanceWithLedger({
              renterId,
              type: "charge",
              amountCents,
              note,
              renterNameSnapshot: renter?.displayName || "Unknown renter",
            });
            await addHistoryEvent({
              actionType: "charge_created",
              renterId,
              renterName: renter?.displayName || "Unknown renter",
              amountCents,
              summary: `Charge created: ${note}`,
            });
            successCount += 1;
          } catch (error) {
            failedCount += 1;
            failures.push(`${renter?.displayName || renterId}: ${error.message}`);
          }
        }

        const totalAmount = amountCents * successCount;
        resultElement.innerHTML = `
          <div class="timeline-item">
            <strong>Charge batch complete</strong>
            <p>${successCount} charges created · Total billed ${money(totalAmount)}</p>
            <p>${failedCount} failures</p>
            ${failures.length ? `<p class="subline">${safe(failures.join(" | "))}</p>` : ""}
          </div>
        `;
        showToast(`Created ${successCount} charges`);
      });

      renderCheckboxes();
    }
  );
}

function openEmailOptionsModal(renterId) {
  const renter = state.renters.find((item) => item.id === renterId);
  if (!renter) return;

  const message = buildEmailMessage(renter);

  openModal(
    "Email Options",
    `
    <div class="form-grid">
      <div><label>To</label><input id="emailTo" value="${safe(message.toEmail)}" /></div>
      <div><label>Subject</label><input id="emailSubject" value="${safe(message.subject)}" /></div>
      <div class="full"><label>Message</label><textarea id="emailBody">${safe(message.body)}</textarea></div>
      <div class="full subline" id="emailOpenHint">Choose an option below. You can always mark as sent manually.</div>
      <div class="modal-actions full">
        <button type="button" class="btn" id="openDefaultBtn">Open Default Email Client</button>
        <button type="button" class="btn" id="openGmailBtn">Open Gmail</button>
        <button type="button" class="btn" id="copyMessageBtn">Copy Message</button>
        <button type="button" class="btn accent" id="markEmailSentBtn">Mark as Sent</button>
      </div>
    </div>
  `,
    () => {
      const getCurrentPayload = () => {
        const toEmail = document.getElementById("emailTo").value.trim();
        const subject = document.getElementById("emailSubject").value.trim();
        const body = document.getElementById("emailBody").value;
        return { toEmail, subject, body, preview: truncate(body.replace(/\n+/g, " ")) };
      };

      const openHint = document.getElementById("emailOpenHint");

      document.getElementById("copyMessageBtn").addEventListener("click", async () => {
        const payload = getCurrentPayload();
        await navigator.clipboard.writeText(payload.body);
        showToast("Message copied");
      });

      document.getElementById("openDefaultBtn").addEventListener("click", () => {
        const payload = getCurrentPayload();
        const url = `mailto:${encodeURIComponent(payload.toEmail)}?subject=${encodeURIComponent(payload.subject)}&body=${encodeURIComponent(
          payload.body
        )}`;
        window.open(url, "_blank");
        openHint.textContent = "Email client opened. Click Mark as Sent after you send it.";
      });

      document.getElementById("openGmailBtn").addEventListener("click", () => {
        const payload = getCurrentPayload();
        const url = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(payload.toEmail)}&su=${encodeURIComponent(
          payload.subject
        )}&body=${encodeURIComponent(payload.body)}`;
        window.open(url, "_blank");
        openHint.textContent = "Gmail compose opened. Click Mark as Sent after you send it.";
      });

      document.getElementById("markEmailSentBtn").addEventListener("click", async () => {
        const payload = getCurrentPayload();
        await updateDoc(doc(db, "renters", renter.id), {
          emailLastSentAt: Timestamp.now(),
          emailLastSentBy: adminEmail,
          emailLastMessagePreview: truncate(payload.preview, 200),
          updatedAt: serverTimestamp(),
        });

        await addHistoryEvent({
          actionType: "email_marked_sent",
          renterId: renter.id,
          renterName: renter.displayName,
          summary: `Email marked sent to ${payload.toEmail}`,
          metadata: {
            subject: payload.subject,
            messagePreview: truncate(payload.preview, 200),
            messageHash: message.messageHash,
          },
        });

        closeModal();
        showToast("Email marked as sent");
      });
    }
  );
}

function getHistoryBucketLabel(date) {
  const now = new Date();
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayDiff = Math.round((today - target) / (1000 * 60 * 60 * 24));

  if (dayDiff === 0) return "Today";
  if (dayDiff === 1) return "Yesterday";
  if (dayDiff <= 7) return "This Week";
  return "Older";
}

function openHistoryModal() {
  openModal(
    "History",
    `
    <div class="form-grid">
      <div>
        <label for="historyRenterFilter">Filter by renter</label>
        <select id="historyRenterFilter">
          <option value="">All renters</option>
          ${state.renters.map((renter) => `<option value="${renter.id}">${safe(renter.displayName)}</option>`).join("")}
        </select>
      </div>
      <div>
        <label for="historyActionFilter">Filter by action</label>
        <select id="historyActionFilter">
          <option value="">All actions</option>
          <option value="charge_created">Charge created</option>
          <option value="payment_recorded">Payment recorded</option>
          <option value="email_marked_sent">Email marked sent</option>
          <option value="renter_edited">Renter edited</option>
          <option value="renter_deleted">Renter deleted</option>
        </select>
      </div>
      <div class="full">
        <label for="historySearchInput">Search</label>
        <input id="historySearchInput" placeholder="Search renter, summary, or actor" />
      </div>
      <div class="full history-list" id="historyList"></div>
    </div>
  `,
    () => {
      const renterFilter = document.getElementById("historyRenterFilter");
      const actionFilter = document.getElementById("historyActionFilter");
      const searchFilter = document.getElementById("historySearchInput");
      const list = document.getElementById("historyList");

      const renderHistoryList = () => {
        const renterId = renterFilter.value;
        const action = actionFilter.value;
        const queryText = searchFilter.value.trim().toLowerCase();

        const filtered = state.historyItems.filter((item) => {
          if (renterId && item.renterId !== renterId) return false;
          if (action && item.actionType !== action) return false;
          const haystack = [item.renterName, item.summary, item.actor, item.metadata?.subject]
            .map((value) => safe(value).toLowerCase())
            .join(" ");
          return haystack.includes(queryText);
        });

        if (!filtered.length) {
          list.innerHTML = "<p class='subline'>No history records match these filters.</p>";
          return;
        }

        const grouped = new Map();
        filtered.forEach((item) => {
          const createdAtDate = item.createdAt?.toDate ? item.createdAt.toDate() : new Date(item.createdAt || Date.now());
          const bucket = getHistoryBucketLabel(createdAtDate);
          const arr = grouped.get(bucket) || [];
          arr.push(item);
          grouped.set(bucket, arr);
        });

        const order = ["Today", "Yesterday", "This Week", "Older"];
        list.innerHTML = order
          .filter((bucket) => grouped.has(bucket))
          .map((bucket) => {
            const rows = grouped
              .get(bucket)
              .map((item) => {
                return `
                  <div class="timeline-item">
                    <strong>${safe(item.summary)}</strong>
                    <p class="subline">${formatDateTime(item.createdAt)} · ${safe(item.actor || "System")} · ${safe(item.renterName || "Unknown renter")}</p>
                    <p class="subline">Action: ${safe(item.actionType)}${item.amountCents ? ` · Amount: ${money(item.amountCents)}` : ""}</p>
                    ${item.renterId ? `<button class="btn btn-small" data-open-renter="${item.renterId}">Open renter</button>` : ""}
                  </div>
                `;
              })
              .join("");
            return `<section><h3>${bucket}</h3>${rows}</section>`;
          })
          .join("");

        list.querySelectorAll("[data-open-renter]").forEach((btn) => {
          btn.addEventListener("click", () => {
            const renter = state.renters.find((item) => item.id === btn.getAttribute("data-open-renter"));
            if (renter && renter.status !== "deleted") {
              closeModal();
              openDrawer(renter.id);
            } else {
              showToast("Renter is deleted or unavailable");
            }
          });
        });
      };

      renterFilter.addEventListener("change", renderHistoryList);
      actionFilter.addEventListener("change", renderHistoryList);
      searchFilter.addEventListener("input", renderHistoryList);
      renderHistoryList();
    }
  );
}

function setupRealtimeListeners() {
  onSnapshot(query(collection(db, "renters"), orderBy("updatedAt", "desc")), (snapshot) => {
    state.renters = snapshot.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((renter) => !renter.ownerUid || renter.ownerUid === adminUid);
    renderTable();

    if (state.selectedRenterId && drawer.classList.contains("open")) {
      const renter = state.renters.find((item) => item.id === state.selectedRenterId);
      if (renter && renter.status !== "deleted") openDrawer(state.selectedRenterId);
      else closeDrawer();
    }
  );
}

function setupBackToTop() {
  window.addEventListener("scroll", () => {
    if (window.scrollY > 300) backToTopBtn.classList.add("show");
    else backToTopBtn.classList.remove("show");
  });

  onSnapshot(query(collection(db, "ledger"), orderBy("createdAt", "desc"), limit(500)), (snapshot) => {
    const ledgerByRenter = new Map();
    snapshot.docs.forEach((docSnap) => {
      const entry = { id: docSnap.id, ...docSnap.data() };
      if (entry.ownerUid && entry.ownerUid !== adminUid) return;
      const arr = ledgerByRenter.get(entry.renterId) || [];
      arr.push(entry);
      ledgerByRenter.set(entry.renterId, arr);
    });

function setupMobileBottomNav() {
  mobileBottomNav?.querySelectorAll("button[data-action]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const action = button.getAttribute("data-action");
      if (action === "home") {
        closeModal();
        closeDrawer();
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
      if (action === "add-renter") openAddRenterModal();
      if (action === "charge") openCreateChargeModal();
      if (action === "history") openHistoryModal();
      if (action === "settings") window.location.href = "/html/settings.html";
      if (action === "logout") logoutBtn.click();
    });
  });

  onSnapshot(query(collection(db, "history"), orderBy("createdAt", "desc"), limit(500)), (snapshot) => {
    state.historyItems = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
  });
}

searchInput.addEventListener("input", (e) => {
  state.searchText = e.target.value;
  renderTable();
});

addRenterBtn.addEventListener("click", openAddRenterModal);
globalChargeBtn.addEventListener("click", openCreateChargeModal);
historyBtn.addEventListener("click", openHistoryModal);

logoutBtn.addEventListener("click", () => {
  localStorage.removeItem("boothrent_admin");
  sessionStorage.removeItem("boothrent_admin");
  localStorage.removeItem("boothrent_admin_email");
  localStorage.removeItem("boothrent_admin_uid");
  window.location.href = "/html/login.html";
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
setupBackToTop();
setupMobileBottomNav();
loadBusinessProfile();
