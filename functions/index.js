import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue, FieldPath } from 'firebase-admin/firestore';

initializeApp();
const db = getFirestore();

export const claimInvite = onCall(async (request) => {
  const uid = request.auth?.uid;
  const authEmail = request.auth?.token?.email?.toLowerCase();
  const inviteId = request.data?.inviteId;

  if (!uid || !authEmail) throw new HttpsError('unauthenticated', 'Please sign in first.');
  if (!inviteId) throw new HttpsError('invalid-argument', 'inviteId is required.');

  const inviteSnaps = await db
    .collectionGroup('invites')
    .where(FieldPath.documentId(), '==', inviteId)
    .limit(1)
    .get();

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

  batch.update(inviteDoc.ref, {
    used: true,
    usedAt: FieldValue.serverTimestamp()
  });

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
