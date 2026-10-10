# contracts · Contratos Soroban

Dueño: Roberto. Contratos en Rust para Stellar, **solo testnet**.

## vaquita · bote colectivo con garantía

Una vaquita en la app hoy paga cada aporte **directo a la wallet del creador** y
la base solo anota quién puso cuánto. Si no se llega a la meta, no hay forma de
devolver nada: la promesa es social y no la respalda nada. Este contrato retiene
los aportes y los deja salir solo por dos caminos:

- **se alcanzó la meta** → `claim`, y solo el beneficiario;
- **venció el plazo sin alcanzarla** → `refund`, y cada quien retira lo suyo.

Nunca las dos: `claim` marca la vaquita cobrada, lo que impide cobrar de nuevo y
cierra cualquier reembolso posterior. El contrato **no tiene dueño ni función de
rescate**: ni quien lo despliega puede sacar los fondos por otro camino.

### Desplegado en testnet

| | |
| --- | --- |
| Contrato | `CAVEZTY2QV5HSGUAA6BXQUZV44MWKAO3PXKX3HXWM73UYHENVXOE3FYJ` |
| Explorador | https://stellar.expert/explorer/testnet/contract/CAVEZTY2QV5HSGUAA6BXQUZV44MWKAO3PXKX3HXWM73UYHENVXOE3FYJ |
| Hash del wasm | `7b85ba9867576ee1246eace2c7134966fb990bc5686412cd596c3084d11115c8` |

Esa instancia está inicializada como prueba (beneficiario: la identidad
`roberto`, token: USDC de testnet, meta: 10 USDC). **Cada vaquita real necesita
su propia instancia**: `init` corre una sola vez por contrato y fija los
términos para siempre.

### Funciones

| Función | Quién | Qué hace |
| --- | --- | --- |
| `init(beneficiary, token, goal, deadline)` | cualquiera, una sola vez | Fija los términos. Rechaza meta ≤ 0 y plazo ya vencido |
| `contribute(from, amount)` | `from`, con su firma | Mueve el token al contrato y acumula lo de esa dirección |
| `claim()` | solo el beneficiario | Se lleva el bote si `raised >= goal`. No espera el plazo |
| `refund(to)` | `to`, con su firma | Devuelve lo aportado, solo con plazo vencido y meta no alcanzada |
| `state()` | lectura | Términos, total recaudado y si ya se cobró |
| `contributed(who)` | lectura | Lo aportado por una dirección (0 si retiró) |

Errores: 1 `AlreadyInitialized`, 2 `NotInitialized`, 3 `InvalidTerms`,
4 `InvalidAmount`, 5 `AlreadyClaimed`, 6 `Expired`, 7 `GoalNotReached`,
8 `NotExpiredYet`, 9 `GoalWasReached`, 10 `NothingToRefund`.

### Trabajar con él

```bash
cd contracts
cargo test              # 18 tests: los bordes donde la plata podría escaparse
stellar contract build  # -> target/wasm32v1-none/release/vaquita.wasm

# Una vaquita nueva = una instancia nueva
stellar contract deploy --wasm target/wasm32v1-none/release/vaquita.wasm \
  --source roberto --network testnet
stellar contract invoke --id <ID> --source roberto --network testnet -- \
  init --beneficiary <G...> --token <TOKEN> --goal <stroops> --deadline <epoch>
```

Los montos van en **stroops** (7 decimales): 10 USDC = `100000000`.

### Lo que falta

- **No está integrado con la app todavía.** `app/services/api/vaquita.ts` sigue
  pagando directo al creador; enchufarlo implica desplegar una instancia por
  vaquita y guardar su id en `public.vaquitas`.
- **Sin auditar.** Los 18 tests cubren los bordes que conozco, y las guardas se
  probaron contra la red real (`claim` sin meta → #7, `refund` antes del plazo →
  #8, `init` repetido → #1), pero eso no equivale a una auditoría. Es testnet.
- Un aporte que supere la meta se cobra completo: no hay devolución del exceso.
