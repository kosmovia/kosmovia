#![no_std]

//! Vaquita con garantía: un bote colectivo que el contrato retiene.
//!
//! Hoy, en la app, cada aporte a una vaquita se paga directo a la wallet del
//! creador y la base solo anota quién puso cuánto. Si no se llega a la meta, no
//! hay forma de devolver nada: la promesa es social y no la respalda nada.
//!
//! Acá los aportes quedan en el contrato y salen por un solo camino a la vez:
//!
//!   - meta alcanzada, dentro del plazo de cobro -> `claim`, solo el beneficiario;
//!   - plazo vencido sin alcanzar la meta        -> `refund`, cada quien lo suyo;
//!   - plazo de cobro vencido sin que cobrara    -> `refund`, aunque se haya
//!     alcanzado la meta: pasado ese punto el bote es de quienes aportaron.
//!
//! Ese último caso existe porque sin él un beneficiario que pierde su llave (o
//! que simplemente no cobra) deja la plata encerrada para siempre. Después de
//! `deadline + GRACE` el beneficiario ya no puede cobrar: no hay carrera entre
//! `claim` y `refund`, cada uno tiene su ventana.
//!
//! El contrato **no tiene dueño ni función de rescate**: ni quien lo despliega
//! puede sacar los fondos por otro camino. Los términos se fijan en el
//! constructor, en la misma transacción del despliegue, así que nadie puede
//! adelantarse a inicializarlo apuntándolo a su propia wallet.
//!
//! Todo en testnet.

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, token, Address, Env};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// Meta o plazo sin sentido (meta <= 0, plazo en el pasado o demasiado lejos).
    InvalidTerms = 3,
    /// Monto <= 0.
    InvalidAmount = 4,
    /// Ya se cobró: no se aporta ni se reembolsa más.
    AlreadyClaimed = 5,
    /// El plazo venció: no se aceptan más aportes.
    Expired = 6,
    /// `claim` sin haber alcanzado la meta.
    GoalNotReached = 7,
    /// `refund` antes de que venza el plazo.
    NotExpiredYet = 8,
    /// `refund` de una vaquita que alcanzó la meta y aún está en plazo de cobro.
    GoalWasReached = 9,
    /// `refund` de quien no aportó, o que ya retiró.
    NothingToRefund = 10,
    /// `claim` después del plazo de cobro: el bote pasó a ser de los aportantes.
    ClaimWindowClosed = 11,
}

#[contracttype]
#[derive(Clone)]
pub enum Key {
    /// Parámetros y total, en una sola entrada: se leen juntos en cada llamada.
    Pot,
    /// Lo aportado por una dirección. Persistente: es la plata de esa persona.
    Share(Address),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Pot {
    /// Quien recibe el bote si se alcanza la meta y cobra en plazo.
    pub beneficiary: Address,
    /// El token que se acepta (en la app, el USDC de testnet).
    pub token: Address,
    pub goal: i128,
    /// Segundos epoch; después de este instante no se aporta más.
    pub deadline: u64,
    /// Lo que hay en el bote ahora. Baja con cada reembolso.
    pub raised: i128,
    /// El beneficiario ya cobró: la vaquita está terminada.
    pub claimed: bool,
}

/// Ledgers en ~24 h, a 5 s por ledger.
const DAY_LEDGERS: u32 = 17_280;
/// El estado se renueva por 90 días en cada operación.
const TTL: u32 = DAY_LEDGERS * 90;
/// Tope del plazo: 60 días. Junto con GRACE entra holgado en el TTL, así que una
/// vaquita que nadie toca sigue teniendo estado vivo durante toda su vida útil.
const MAX_DEADLINE_SECS: u64 = 60 * 24 * 60 * 60;
/// Ventana del beneficiario para cobrar tras el plazo. Después, el bote vuelve
/// a los aportantes.
const GRACE_SECS: u64 = 15 * 24 * 60 * 60;

#[contract]
pub struct Vaquita;

#[contractimpl]
impl Vaquita {
    /// Fija los términos en la misma transacción del despliegue.
    pub fn __constructor(
        env: Env,
        beneficiary: Address,
        token: Address,
        goal: i128,
        deadline: u64,
    ) -> Result<(), Error> {
        let now = env.ledger().timestamp();
        if goal <= 0 || deadline <= now || deadline > now + MAX_DEADLINE_SECS {
            return Err(Error::InvalidTerms);
        }
        env.storage().instance().set(
            &Key::Pot,
            &Pot { beneficiary, token, goal, deadline, raised: 0, claimed: false },
        );
        env.storage().instance().extend_ttl(TTL, TTL);
        Ok(())
    }

    /// Aporta `amount` al bote. El token sale de `from`, que debe autorizar.
    ///
    /// Aportar de nuevo suma a lo que esa dirección ya tenía: el reembolso
    /// después devuelve el total, no el último aporte.
    pub fn contribute(env: Env, from: Address, amount: i128) -> Result<i128, Error> {
        from.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let mut pot = Self::pot(&env);
        if pot.claimed {
            return Err(Error::AlreadyClaimed);
        }
        if env.ledger().timestamp() > pot.deadline {
            return Err(Error::Expired);
        }

        // Estado primero y transferencia al final, igual que en claim y refund:
        // si el token falla, la invocación entera se revierte, así que escribir
        // antes no puede dejar el bote diciendo que recibió algo que no recibió.
        let share = Self::share_of(&env, &from) + amount;
        pot.raised += amount;
        Self::save_share(&env, &from, share);
        Self::save_pot(&env, &pot);

        token::Client::new(&env, &pot.token).transfer(&from, &env.current_contract_address(), &amount);
        Ok(share)
    }

    /// El beneficiario se lleva todo el bote. Solo con la meta alcanzada y
    /// dentro del plazo de cobro (`deadline + GRACE`).
    ///
    /// No espera el `deadline`: alcanzada la meta, retener la plata no protege a
    /// nadie. `claimed` es lo que impide cobrar dos veces y cierra la puerta a
    /// cualquier reembolso posterior.
    pub fn claim(env: Env) -> Result<i128, Error> {
        let mut pot = Self::pot(&env);
        pot.beneficiary.require_auth();
        if pot.claimed {
            return Err(Error::AlreadyClaimed);
        }
        if pot.raised < pot.goal {
            return Err(Error::GoalNotReached);
        }
        if env.ledger().timestamp() > pot.deadline + GRACE_SECS {
            return Err(Error::ClaimWindowClosed);
        }

        let amount = pot.raised;
        pot.claimed = true;
        Self::save_pot(&env, &pot);
        token::Client::new(&env, &pot.token).transfer(
            &env.current_contract_address(),
            &pot.beneficiary,
            &amount,
        );
        Ok(amount)
    }

    /// Devuelve a `to` lo que aportó, en dos situaciones: plazo vencido sin
    /// alcanzar la meta, o plazo de cobro vencido sin que el beneficiario
    /// cobrara (ahí el bote es de los aportantes, se haya alcanzado o no).
    ///
    /// El aporte se borra y `raised` baja antes de transferir, así que nadie
    /// retira dos veces y `state()` nunca muestra plata que ya se fue.
    pub fn refund(env: Env, to: Address) -> Result<i128, Error> {
        to.require_auth();
        let mut pot = Self::pot(&env);
        if pot.claimed {
            return Err(Error::AlreadyClaimed);
        }
        let now = env.ledger().timestamp();
        if now <= pot.deadline {
            return Err(Error::NotExpiredYet);
        }
        // Con la meta alcanzada hay que esperar a que se cierre la ventana de cobro.
        if pot.raised >= pot.goal && now <= pot.deadline + GRACE_SECS {
            return Err(Error::GoalWasReached);
        }
        let share = Self::share_of(&env, &to);
        if share <= 0 {
            return Err(Error::NothingToRefund);
        }

        pot.raised -= share;
        env.storage().persistent().remove(&Key::Share(to.clone()));
        Self::save_pot(&env, &pot);
        token::Client::new(&env, &pot.token).transfer(&env.current_contract_address(), &to, &share);
        Ok(share)
    }

    /// Los términos y el total, para que la app muestre el progreso.
    pub fn state(env: Env) -> Pot {
        Self::pot(&env)
    }

    /// Lo aportado por una dirección (0 si no aportó o ya retiró).
    pub fn contributed(env: Env, who: Address) -> i128 {
        Self::share_of(&env, &who)
    }

    /// Hasta cuándo puede cobrar el beneficiario; pasado eso, manda `refund`.
    pub fn claim_deadline(env: Env) -> u64 {
        Self::pot(&env).deadline + GRACE_SECS
    }

    /// El constructor corre al desplegar, así que el bote siempre existe.
    fn pot(env: &Env) -> Pot {
        env.storage()
            .instance()
            .get(&Key::Pot)
            .unwrap_or_else(|| panic!("sin inicializar"))
    }

    fn save_pot(env: &Env, pot: &Pot) {
        env.storage().instance().set(&Key::Pot, pot);
        env.storage().instance().extend_ttl(TTL, TTL);
    }

    fn save_share(env: &Env, who: &Address, share: i128) {
        env.storage().persistent().set(&Key::Share(who.clone()), &share);
        env.storage().persistent().extend_ttl(&Key::Share(who.clone()), TTL, TTL);
    }

    fn share_of(env: &Env, who: &Address) -> i128 {
        env.storage().persistent().get(&Key::Share(who.clone())).unwrap_or(0)
    }
}

mod test;
