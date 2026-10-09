import type { Metadata } from 'next';
import LegalLayout from '../../components/LegalLayout';

export const metadata: Metadata = {
  title: 'Términos · Kosmovia',
  description: 'Condiciones de la beta de Kosmovia: comunidades, wallets, pagos de prueba y reglas de uso en Stellar testnet.',
};

export default function TerminosPage() {
  return <LegalLayout title="Términos y Condiciones" draft
    intro="Estas condiciones explican cómo usar Kosmovia durante la beta. Al continuar con el acceso, aceptas estos Términos y la Política de Privacidad."
    sections={[
      { id: 'kosmovia', title: 'Qué es Kosmovia', content: <p>Kosmovia es una plataforma de comunidades con chat, wallet de USDC y pagos en la red Stellar. Empezamos en Bolivia. Kosmovia no es un banco y no ofrece asesoría financiera.</p> },
      { id: 'testnet', title: 'Beta en testnet: sin dinero real', content: <p>La beta funciona únicamente en testnet, la red de pruebas de Stellar. No se mueve dinero real: los saldos y el USDC de prueba no tienen valor monetario. Las funciones pueden cambiar, fallar o dejar de estar disponibles; los datos y saldos de prueba pueden reiniciarse.</p> },
      { id: 'cuenta', title: 'Tu cuenta y tu PIN', content: <><p>Cuida el acceso a tu cuenta y no compartas tu PIN de pagos. Revisa el destinatario y el monto antes de confirmar cada operación. No uses cuentas ajenas ni suplantes a otra persona.</p><p>Cada pago se confirma con un PIN de seis dígitos, guardado como hash. Es una confirmación dentro de la aplicación, no una barrera criptográfica ni un reemplazo de la seguridad de tu wallet.</p></> },
      { id: 'wallet', title: 'Quién controla tu wallet', content: <><p>Si entras con Google o email, el tercero <a href="https://pollar.xyz">Pollar</a> crea y custodia tu wallet. Ese servicio depende de sus propias condiciones y disponibilidad. Kosmovia no custodia tus claves privadas.</p><p>Si conectas tu propia wallet con Freighter, tú controlas esa wallet. Kosmovia no controla sus claves ni puede recuperarlas por ti. Nunca compartas tus claves privadas o tu frase semilla.</p></> },
      { id: 'pagos', title: 'Pagos en Stellar', content: <p>Los pagos confirmados en Stellar son irreversibles, también en testnet. Kosmovia no puede anularlos ni garantizar que el destinatario devuelva un envío equivocado. Verifica siempre el @usuario, la dirección y el monto.</p> },
      { id: 'comisiones', title: 'Costo de la beta', content: <p>La beta es gratis y no cobra comisiones. Si en el futuro se incorporan comisiones, se avisará con al menos 30 días de anticipación, indicando los costos antes de que correspondan.</p> },
      { id: 'comunidades', title: 'Reglas de las comunidades', content: <><p>Respeta a las personas y las reglas de cada comunidad. Está prohibido:</p><ul><li>El fraude y las estafas.</li><li>El contenido ilegal.</li><li>El acoso y las amenazas.</li><li>Las apuestas con dinero.</li><li>La suplantación de identidad.</li></ul></> },
      { id: 'moderacion', title: 'Moderación y suspensión', content: <p>Podemos retirar contenido, limitar funciones o suspender cuentas que incumplan estas reglas, comprometan la seguridad o se usen para abusar del servicio. Los responsables de cada comunidad también pueden moderar sus espacios. Si consideras que hubo un error, usa el contacto indicado al final.</p> },
      { id: 'aplicaciones', title: 'Mini-apps', content: <p>Las mini-apps oficiales, como Vaquita para aportes colectivos, funcionan dentro de Kosmovia. En el futuro podrían incorporarse mini-apps de terceros aprobadas; eso no significa que estén disponibles ahora. Las mini-apps nunca ven tu PIN ni tus claves privadas. Revisa qué datos y acciones solicita cada aplicación antes de usarla.</p> },
      { id: 'responsabilidad', title: 'Límites de responsabilidad', content: <p>La beta se ofrece como servicio de prueba, sin garantizar funcionamiento continuo ni ausencia de errores. En la medida permitida por la ley aplicable, Kosmovia no responde por interrupciones de servicios de terceros, uso indebido de tu cuenta o envíos que confirmes con datos incorrectos. Esta cláusula no excluye responsabilidades ni derechos que la ley no permita limitar.</p> },
      { id: 'cambios', title: 'Cambios a estos términos', content: <p>Podemos actualizar estas condiciones conforme evolucione la beta. Publicaremos la nueva versión y su fecha en esta página, y avisaremos en la plataforma si el cambio afecta de forma relevante tu uso. El aviso de 30 días se mantiene para futuras comisiones.</p> },
      { id: 'contacto', title: 'Contacto', content: <p>Para consultas o solicitudes, contacta a kosmovia (por ahora en nuestro repositorio de GitHub: <a href="https://github.com/kosmovia/kosmovia">github.com/kosmovia/kosmovia</a>). No publiques tu PIN, claves privadas ni otros datos sensibles allí.</p> },
    ]} />;
}
