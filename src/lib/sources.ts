// Les deux sources de vidéos : YouTube (identifiant de 11 caractères) et les clips Twitch, désignés dans l'app par
// « tc_ » suivi de leur identifiant Twitch.

export const VIDEO_YT = /^[A-Za-z0-9_-]{11}$/;
export const CLIP_ID = /^tc_[A-Za-z0-9_-]{5,120}$/;
export const estClip = (id: string) => id.startsWith("tc_");
export const urlClip = (id: string) => `https://clips.twitch.tv/${id.slice(3)}`;
