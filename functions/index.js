import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue, FieldPath } from 'firebase-admin/firestore';

initializeApp();
const db = getFirestore();

async function assertOwner(uid, shopId) {
  const userSnap = await db.doc(`users/${uid}`).get();
  if (!userSnap.exists) throw new HttpsError('permission-denied', 'User profile missing.');
  const user = userSnap.data();
  if (user.role !== 'owner' || user.shopId !== shopId) {
    throw new HttpsError('permission-denied', 'Only owner for this shop can do that.');
  }
  return user;
}

export const claimInvite = onCall(async (request) => {
  const uid = request.auth?.uid;
  const authEmail = request.auth?.token?.email?.toLowerCase();
  const inviteId = request.data?.inviteId;
  if (!uid || !authEmail) throw new HttpsError('unauthenticated', 'Please sign in first.');
  if (!inviteId) throw new HttpsError('invalid-argument', 'inviteId is required.');

  const inviteSnaps = await db.collectionGroup('invites').where(FieldPath.documentId(), '==', inviteId).limit(1).get();
  if (inviteSnaps.empty) throw new HttpsError('not-found', 'Invite not found.');
  const inviteDoc = inviteSnaps.docs[0];
  const invite = inviteDoc.data();
  const shopId = inviteDoc.ref.parent.parent.id;

  if (invite.used) throw new HttpsError('failed-precondition', 'Invite was already used.');
  if (invite.expiresAt?.toMillis && invite.expiresAt.toMillis() < Date.now()) {
    throw new HttpsError('deadline-exceeded', 'Invite expired.');
  }
  if ((invite.email || '').toLowerCase() !== authEmail) {
    throw new HttpsError('permission-denied', 'Invite email does not match your sign-in email.');
  }

  const batch = db.batch();
  batch.set(db.doc(`users/${uid}`), {
    role: 'staff',
    shopId,
    employeeId: invite.employeeId,
    email: authEmail,
    createdAt: FieldValue.serverTimestamp()
  }, { merge: true });
  batch.update(inviteDoc.ref, { used: true, usedAt: FieldValue.serverTimestamp() });
  batch.set(db.collection(`shops/${shopId}/auditLogs`).doc(), {
    actionType: 'INVITE_CLAIMED',
    employeeId: invite.employeeId,
    weekId: null,
    details: { inviteId },
    actorUid: uid,
    createdAt: FieldValue.serverTimestamp()
  });
  await batch.commit();

  return { ok: true, shopId, employeeId: invite.employeeId };
});

export const sendReminderEmail = onCall(async (request) => {
  const uid = request.auth?.uid;
  const { shopId, employeeId, weekId, mode, inviteId } = request.data || {};
  if (!uid) throw new HttpsError('unauthenticated', 'Please sign in first.');
  if (!shopId || !employeeId) throw new HttpsError('invalid-argument', 'shopId and employeeId are required.');
  await assertOwner(uid, shopId);

  const [shopSnap, empSnap] = await Promise.all([
    db.doc(`shops/${shopId}`).get(),
    db.doc(`shops/${shopId}/employees/${employeeId}`).get()
  ]);
  if (!shopSnap.exists || !empSnap.exists) throw new HttpsError('not-found', 'Shop/employee missing.');

  const shop = shopSnap.data();
  const employee = empSnap.data();
  const staffPortalUrl = mode === 'INVITE'
    ? `${shop.staffPortalBaseUrl || 'https://YOUR_GITHUB_PAGES_URL/staff.html'}?invite=${inviteId}`
    : `${shop.staffPortalBaseUrl || 'https://YOUR_GITHUB_PAGES_URL/staff.html'}`;

  const subject = mode === 'INVITE'
    ? `You're invited to ${shop.businessName} BoothRent Pro`
    : `Rent reminder for ${shop.businessName} (${weekId})`;

  const html = mode === 'INVITE'
    ? `<p>Hi ${employee.name},</p><p>You were invited to the staff portal.</p><p><a href="${staffPortalUrl}">Claim your invite</a></p>`
    : `<p>Hi ${employee.name},</p><p>This is your rent reminder for week ${weekId}.</p><p>Open portal: <a href="${staffPortalUrl}">${staffPortalUrl}</a></p>`;

  await db.collection('mail').add({
    to: employee.email,
    message: {
      subject,
      text: html.replace(/<[^>]+>/g, ' '),
      html
    }
  });

  return { ok: true };
});

export const sendReceiptEmail = onCall(async (request) => {
  const uid = request.auth?.uid;
  const { shopId, employeeId, receiptId } = request.data || {};
  if (!uid) throw new HttpsError('unauthenticated', 'Please sign in first.');
  if (!shopId || !employeeId || !receiptId) throw new HttpsError('invalid-argument', 'shopId, employeeId, receiptId required.');
  await assertOwner(uid, shopId);

  const [shopSnap, empSnap, receiptSnap] = await Promise.all([
    db.doc(`shops/${shopId}`).get(),
    db.doc(`shops/${shopId}/employees/${employeeId}`).get(),
    db.doc(`shops/${shopId}/receipts/${receiptId}`).get()
  ]);
  if (!shopSnap.exists || !empSnap.exists || !receiptSnap.exists) throw new HttpsError('not-found', 'Shop/employee/receipt missing.');

  const shop = shopSnap.data();
  const employee = empSnap.data();
  const receipt = receiptSnap.data();
  const lineHtml = (receipt.lineItems || []).map((item) => `<li>${item.method}: $${(item.amountCents / 100).toFixed(2)} ${item.notes || ''}</li>`).join('');

  await db.collection('mail').add({
    to: employee.email,
    message: {
      subject: `Receipt ${receipt.receiptNumber} from ${shop.businessName}`,
      text: `Receipt ${receipt.receiptNumber}, total $${(receipt.totalCents / 100).toFixed(2)}`,
      html: `<p>Hi ${employee.name},</p><p>Receipt: <strong>${receipt.receiptNumber}</strong></p><p>Total: <strong>$${(receipt.totalCents / 100).toFixed(2)}</strong></p><ul>${lineHtml}</ul>`
    }
  });

  return { ok: true };
});
