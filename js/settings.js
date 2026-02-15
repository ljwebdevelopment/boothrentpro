import { db, serverTimestamp, storage } from "../js/firebase.js";
import {
  doc,
  setDoc,
  getDoc,
  deleteDoc,
  getDocs,
  collection,
  query,
  where,
  writeBatch,
  limit,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  ref,
  uploadBytes,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

const isLoggedIn =
  localStorage.getItem("boothrent_admin") === "true" ||
  sessionStorage.getItem("boothrent_admin") === "true";
if (!isLoggedIn) window.location.href = "/html/login.html";

const adminEmail = localStorage.getItem("boothrent_admin_email") || "admin@boothrent.local";
const adminUid =
  localStorage.getItem("boothrent_admin_uid") ||
  `admin_${btoa(adminEmail).replace(/[^a-zA-Z0-9]/g, "").slice(0, 24)}`;

const settingsForm = document.getElementById("settingsForm");
const statusText = document.getElementById("statusText");
const deleteConfirm = document.getElementById("deleteConfirm");
const deleteAccountBtn = document.getElementById("deleteAccountBtn");
const businessLogoFile = document.getElementById("businessLogoFile");
const businessLogoUrlInput = document.getElementById("businessLogoUrl");
const settingsBottomNav = document.getElementById("settingsBottomNav");

function setStatus(message) {
  statusText.textContent = message;
}

async function deleteDocsByQuery(baseQuery) {
  while (true) {
    const snap = await getDocs(baseQuery);
    if (snap.empty) break;

    const batch = writeBatch(db);
    snap.docs.forEach((item) => batch.delete(item.ref));
    await batch.commit();
  }
}

async function loadSettings() {
  const businessSnap = await getDoc(doc(db, "businesses", adminUid));
  if (!businessSnap.exists()) {
    document.getElementById("businessEmail").value = adminEmail;
    return;
  }

  const data = businessSnap.data();
  document.getElementById("businessName").value = data.businessName || "";
  businessLogoUrlInput.value = data.businessLogoUrl || "";
  document.getElementById("ownerName").value = data.ownerName || "";
  document.getElementById("businessPhone").value = data.businessPhone || "";
  document.getElementById("businessEmail").value = data.businessEmail || adminEmail;
  document.getElementById("businessStreet").value = data.businessAddress?.street || "";
  document.getElementById("businessCity").value = data.businessAddress?.city || "";
  document.getElementById("businessState").value = data.businessAddress?.state || "";
  document.getElementById("businessZip").value = data.businessAddress?.zip || "";
  document.getElementById("receiptFooterNote").value = data.receiptFooterNote || "";
}

settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  let businessLogoUrl = businessLogoUrlInput.value.trim();
  if (businessLogoFile.files?.length) {
    setStatus("Uploading logo...");
    const file = businessLogoFile.files[0];
    const logoRef = ref(storage, `business-logos/${adminUid}/${Date.now()}-${file.name}`);
    await uploadBytes(logoRef, file);
    businessLogoUrl = await getDownloadURL(logoRef);
    businessLogoUrlInput.value = businessLogoUrl;
  }

  await setDoc(
    doc(db, "businesses", adminUid),
    {
      ownerUid: adminUid,
      businessName: document.getElementById("businessName").value.trim(),
      businessLogoUrl,
      ownerName: document.getElementById("ownerName").value.trim(),
      businessPhone: document.getElementById("businessPhone").value.trim(),
      businessEmail: document.getElementById("businessEmail").value.trim(),
      businessAddress: {
        street: document.getElementById("businessStreet").value.trim(),
        city: document.getElementById("businessCity").value.trim(),
        state: document.getElementById("businessState").value.trim(),
        zip: document.getElementById("businessZip").value.trim(),
      },
      receiptFooterNote: document.getElementById("receiptFooterNote").value.trim(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  setStatus("Settings saved. Receipts now use this information.");
});

function setupBottomNavActions() {
  settingsBottomNav?.querySelectorAll("button[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.getAttribute("data-action");
      if (action === "home") window.location.href = "/html/dashboard.html";
      if (action === "add-renter") window.location.href = "/html/dashboard.html?action=add-renter";
      if (action === "charge") window.location.href = "/html/dashboard.html?action=charge";
      if (action === "history") window.location.href = "/html/dashboard.html?action=history";
      if (action === "settings") window.location.href = "/html/settings.html";
      if (action === "logout") {
        localStorage.removeItem("boothrent_admin");
        sessionStorage.removeItem("boothrent_admin");
        localStorage.removeItem("boothrent_admin_email");
        localStorage.removeItem("boothrent_admin_uid");
        window.location.href = "/html/login.html";
      }
    });
  });
}

deleteConfirm.addEventListener("input", () => {
  deleteAccountBtn.disabled = deleteConfirm.value.trim() !== "DELETE ACCOUNT";
});

deleteAccountBtn.addEventListener("click", async () => {
  setStatus("Deleting account data...");

  const ownerCollections = ["renters", "ledger", "history", "messages"];
  for (const name of ownerCollections) {
    await deleteDocsByQuery(query(collection(db, name), where("ownerUid", "==", adminUid), limit(200)));
  }

  await deleteDoc(doc(db, "businesses", adminUid));

  localStorage.removeItem("boothrent_admin");
  sessionStorage.removeItem("boothrent_admin");
  localStorage.removeItem("boothrent_admin_email");
  localStorage.removeItem("boothrent_admin_uid");
  window.location.href = "/html/login.html";
});

loadSettings();
setupBottomNavActions();
