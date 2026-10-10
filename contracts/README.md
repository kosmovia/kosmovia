# contracts · Contratos Soroban

Dueño: Roberto. Contratos en Rust para Stellar, **solo testnet**.

## vaquita · bote colectivo con garantía

Una vaquita en la app hoy paga cada aporte **directo a la wallet del creador** y
la base solo anota quién puso cuánto. Si no se llega a la meta, no hay forma de
devolver nada: la promesa es social y no la respalda nada. Este contrato retiene
los aportes y los deja salir por un solo camino a la vez:

- **meta alcanzada, dentro del plazo de cobro** → `claim`, y solo el beneficiario;
- **venció el plazo sin alcanzarla** → `refund`, y cada quien retira lo suyo;
- **pasó el plazo de cobro sin que el beneficiario cobrara** → `refund`, aunque
  se haya alcanzado la meta: desde ahí el bote es de quienes aportaron.

Ese tercer caso existe porque sin él un beneficiario que pierde su llave (o que
simplemente no cobra) dejaba la plata **encerrada para siempre**. El plazo de
cobro es `deadline + 15 días`, y pasado ese punto el beneficiario ya no puede
cobrar: no hay carrera entre `claim` y `refund`, cada uno tiene su ventana.

El contrato **no tiene dueño ni función de rescate**: ni quien lo despliega
puede sacar los fondos por otro camino. Los términos se fijan en el
**constructor**, en la misma transacción del despliegue, así que nadie puede
adelantarse a inicializarlo apuntándolo a su propia wallet.

### Desplegado en testnet

| | |
| --- | --- |
| Contrato | `CCJ6UGLMXMEYRT5B4PKDGYMQ3BADKGQZHRYSDZ62UWKLUBCSDZNRTBYM` |
| Explorador | https://stellar.expert/explorer/testnet/contract/CCJ6UGLMXMEYRT5B4PKDGYMQ3BADKGQZHRYSDZ62UWKLUBCSDZNRTBYM |
| Hash del wasm | ver `stellar contract build` (se revisó y redesplegó: la instancia anterior `CAVEZ…CEL` quedó obsoleta) |

Esa instancia es de prueba (beneficiario: la identidad `roberto`, token: USDC de
testnet, meta: 10 USDC, plazo: 7 días). **Cada vaquita real necesita su propia
instancia**: los términos se fijan al desplegar y no se cambian nunca más.

### Funciones

| Función | Quién | Qué hace |
| --- | --- | --- |
| `__constructor(beneficiary, token, goal, deadline)` | al desplegar | Fija los términos. Rechaza meta ≤ 0, plazo vencido y plazo a más de 60 días |
| `contribute(from, amount)` | `from`, con su firma | Mueve el token al contrato y acumula lo de esa dirección |
| `claim()` | solo el beneficiario | Se lleva el bote si `raised >= goal`, hasta `deadline + 15 días`. No espera el plazo |
| `refund(to)` | `to`, con su firma | Devuelve lo aportado: con plazo vencido y meta no alcanzada, o pasado el plazo de cobro sin que cobraran |
| `state()` | lectura | Términos, total recaudado y si ya se cobró |
| `contributed(who)` | lectura | Lo aportado por una dirección (0 si retiró) |
| `claim_deadline()` | lectura | Hasta cuándo puede cobrar el beneficiario |

Errores: 3 `InvalidTerms`, 4 `InvalidAmount`, 5 `AlreadyClaimed`, 6 `Expired`,
7 `GoalNotReached`, 8 `NotExpiredYet`, 9 `GoalWasReached`,
10 `NothingToRefund`, 11 `ClaimWindowClosed`.

### Trabajar con él

```bash
cd contracts
cargo test              # 25 tests: los bordes donde la plata podría escaparse
stellar contract build  # -> target/wasm32v1-none/release/vaquita.wasm

# Una vaquita nueva = una instancia nueva. Los términos van en el propio deploy:
# no hay un init suelto que alguien pueda adelantarse a llamar.
stellar contract deploy --wasm target/wasm32v1-none/release/vaquita.wasm \
  --source roberto --network testnet -- \
  --beneficiary <G...> --token <TOKEN> --goal <stroops> --deadline <epoch>
```

Los montos van en **stroops** (7 decimales): 10 USDC = `100000000`.

### Lo que falta

- **No está integrado con la app todavía.** `app/services/api/vaquita.ts` sigue
  pagando directo al creador; enchufarlo implica desplegar una instancia por
  vaquita y guardar su id en `public.vaquitas`.
- **Sin auditar.** Los 25 tests cubren los bordes que conozco y las guardas se
  probaron contra la red real (`claim` sin meta → #7, `refund` antes del plazo →
  #8), pero eso no equivale a una auditoría. Es testnet.
- Un aporte que supere la meta se cobra completo: no hay devolución del exceso.
- **Quien pague a la dirección del contrato sin pasar por `contribute` pierde esa
  plata**: no suma al bote y no hay barrido (agregarlo exigiría un dueño, que es
  justo lo que este contrato no tiene). Hay un test que fija ese límite.
- El plazo no puede pasar de 60 días: con uno más largo el estado se archivaría
  antes de que alguien pudiera retirar.
