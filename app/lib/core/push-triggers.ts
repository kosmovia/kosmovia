import * as pushRepo from "./db/push-repo.ts";
import * as repo from "./db/repo.ts";
import { profileIdFromWallet } from "./ids.ts";
import { fireAndForget, notify } from "./push.ts";
import { dmText, extractMentions, mentionText, paymentText, pickMentionRecipients } from "./push-rules.ts";

/**
 * Los disparadores de las notificaciones: se llaman DESPUÉS de que la acción se guardó,
 * sin `await` (son fire-and-forget: no demoran la respuesta ni la rompen) y nunca
 * le avisan a quien hizo la acción. Con el push apagado no hacen ni una consulta.
 * Server-only.
 */

/** Pago registrado: avisa al destinatario si es un perfil de Kosmovia. */
export function notifyPayment(payment: repo.PaymentWire, senderId: string): void {
  fireAndForget(async () => {
    const recipientId = profileIdFromWallet(payment.to_wallet);
    if (recipientId === senderId) return;
    const text = paymentText({
      amount: payment.amount,
      asset: payment.asset,
      fromUsername: payment.from_profile?.username ?? null,
    });
    await notify(recipientId, { kind: "payments", ...text, url: "/plataforma?panel=wallet", tag: `payment-${payment.id}` });
  });
}

/** Mensaje directo: avisa al otro participante con una vista previa corta. */
export function notifyDm(threadId: string, senderId: string, content: string): void {
  fireAndForget(async () => {
    const who = await pushRepo.dmRecipient(threadId, senderId);
    if (!who || who.recipientId === senderId) return;
    const text = dmText(who.senderUsername, content);
    await notify(who.recipientId, { kind: "dms", ...text, url: `/plataforma?dm=${encodeURIComponent(threadId)}`, tag: `dm-${threadId}` });
  });
}

/** @usuario en un canal: avisa a cada mencionado que es miembro y puede ver el canal (máx 10). */
export function notifyMentions(channelId: string, authorId: string, content: string): void {
  fireAndForget(async () => {
    const usernames = extractMentions(content);
    if (usernames.length === 0) return;
    const access = await repo.getChannelAccess(channelId, authorId);
    if (!access.found) return;
    const [candidates, authorName] = await Promise.all([
      pushRepo.mentionCandidates(access.communityId, usernames),
      pushRepo.usernameOf(authorId),
    ]);
    if (!authorName) return;
    const recipients = pickMentionRecipients(candidates, { authorId, visibility: access.visibility });
    const text = mentionText(authorName, access.name);
    await Promise.allSettled(
      recipients.map((r) => notify(r.id, { kind: "mentions", ...text, url: `/plataforma?channel=${encodeURIComponent(channelId)}`, tag: `mention-${channelId}` })),
    );
  });
}
