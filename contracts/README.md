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
| Contrato | `CC74PI4EY3HPFJU4P3M2ODUB64WO6BSDJCJRPL6OYU5P6UKH27DFOXBJ` |
| Explorador | https://stellar.expert/explorer/testnet/contract/CC74PI4EY3HPFJU4P3M2ODUB64WO6BSDJCJRPL6OYU5P6UKH27DFOXBJ |
| Hash del wasm | ver `stellar contract build`. Instancias anteriores (`CAVEZ…CEL`, `CCJ6…BYM`) quedaron obsoletas |

**Un contrato, muchos botes.** Cada vaquita es un `pot_id` adentro de esa única
dirección, no una instancia aparte. La razón es práctica: el backend de Pollar
valida cada autorización de una wallet custodial (Google/email) contra una
**lista blanca de contratos por app**, así que una dirección nueva por vaquita
obligaría a tocar esa lista cada vez. Con una sola dirección se autoriza una vez
y sirve para todas.

Los términos de cada bote se fijan al crearlo y no se cambian nunca más. Esa
instancia ya tiene dos botes de prueba (ids 1 y 2).

### Funciones

| Función | Quién | Qué hace |
| --- | --- | --- |
| `create_pot(beneficiary, token, goal, deadline) -> u32` | cualquiera | Abre un bote y devuelve su id. Rechaza meta ≤ 0, plazo vencido y plazo a más de 60 días |
| `contribute(pot_id, from, amount)` | `from`, con su firma | Mueve el token al contrato y acumula lo de esa dirección |
| `claim(pot_id)` | solo el beneficiario | Se lleva el bote si `raised >= goal`, hasta `deadline + 15 días`. No espera el plazo |
| `refund(pot_id, to)` | `to`, con su firma | Devuelve lo aportado: con plazo vencido y meta no alcanzada, o pasado el plazo de cobro sin que cobraran |
| `state(pot_id)` | lectura | Términos, total recaudado y si ya se cobró |
| `contributed(pot_id, who)` | lectura | Lo aportado por una dirección (0 si retiró) |
| `claim_deadline(pot_id)` | lectura | Hasta cuándo puede cobrar el beneficiario |

Errores: 2 `NoSuchPot`, 3 `InvalidTerms`, 4 `InvalidAmount`, 5 `AlreadyClaimed`, 6 `Expired`,
7 `GoalNotReached`, 8 `NotExpiredYet`, 9 `GoalWasReached`,
10 `NothingToRefund`, 11 `ClaimWindowClosed`.

### Trabajar con él

```bash
cd contracts
cargo test              # 25 tests: los bordes donde la plata podría escaparse
stellar contract build  # -> target/wasm32v1-none/release/vaquita.wasm

# El contrato se despliega UNA vez; cada vaquita es un bote adentro.
stellar contract invoke --id <CONTRATO> --source roberto --network testnet -- \
  create_pot --beneficiary <G...> --token <TOKEN> --goal <stroops> --deadline <epoch>
```

Los montos van en **stroops** (7 decimales): 10 USDC = `100000000`.

### Lo que falta

- **No está integrado con la app todavía.** `app/services/api/vaquita.ts` sigue
  pagando directo al creador. Enchufarlo necesita, además de código: guardar el
  `pot_id` en `public.vaquitas`, y **autorizar esta dirección y sus funciones en
  la lista blanca del dashboard de Pollar** — sin eso las wallets de Google y
  email no pueden firmar ningún aporte, por más que el contrato esté bien.
- **Sin auditar.** Los 25 tests cubren los bordes que conozco y las guardas se
  probaron contra la red real (`claim` sin meta → #7, `refund` antes del plazo →
  #8), pero eso no equivale a una auditoría. Es testnet.
- Un aporte que supere la meta se cobra completo: no hay devolución del exceso.
- **Quien pague a la dirección del contrato sin pasar por `contribute` pierde esa
  plata**: no suma al bote y no hay barrido (agregarlo exigiría un dueño, que es
  justo lo que este contrato no tiene). Hay un test que fija ese límite.
- El plazo no puede pasar de 60 días: con uno más largo el estado se archivaría
  antes de que alguien pudiera retirar.
