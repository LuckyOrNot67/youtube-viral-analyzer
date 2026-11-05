import "server-only";

// Envoi d'emails par Resend (resend.com). Clés dans .env.local : RESEND_API_KEY et EMAIL_FROM
// (« Viral Analyzer <bonjour@ton-domaine.fr> », sur un domaine vérifié chez Resend). Sans elles, rien ne part :
// l'email est seulement écrit dans le journal du serveur.

export const emailPret = () => Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);

export async function envoyerEmail(a: string, sujet: string, texte: string): Promise<boolean> {
  if (!emailPret()) {
    console.info(`[email] non envoyé (RESEND_API_KEY ou EMAIL_FROM manquant) : « ${sujet} »`);
    return false;
  }
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [a], subject: sujet, text: texte }),
  }).catch((e: Error) => { console.warn("[email]", e.message); return null; });
  if (r && !r.ok) console.warn("[email]", r.status, (await r.text()).slice(0, 300));
  return Boolean(r?.ok);
}
