import { renderAvatar, type AvatarStyle } from "@/lib/avatar/generator";

export interface AvatarProps {
  seed: string;
  /** Cualquier valor: uno que no sea un estilo conocido se ignora y se elige uno desde la semilla. */
  style?: AvatarStyle | string | null;
  /** Lado en píxeles (círculo; los Kosmonautas, cuadrado redondeado). */
  size?: number;
  /** Para el texto accesible: "Avatar de @usuario". */
  username?: string;
  className?: string;
}

export function Avatar({ seed, style, size = 64, username, className }: AvatarProps) {
  // renderAvatar recorta la semilla a 64 caracteres y descarta estilos desconocidos;
  // nada de seed ni style llega al marcado (se usa con dangerouslySetInnerHTML).
  const svg = renderAvatar(seed, style);
  const classes = ["avatar", style === "kosmonauta" ? "avatar-pixel" : null, className].filter(Boolean).join(" ");
  const handle = username ? (username.startsWith("@") ? username : `@${username}`) : null;
  return (
    <span
      className={classes}
      role="img"
      aria-label={handle ? `Avatar de ${handle}` : "Avatar generado"}
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
