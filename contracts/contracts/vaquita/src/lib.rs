#![no_std]

//! Vaquitas con garantía: botes colectivos que el contrato retiene.
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
//! **Un contrato, muchos botes.** Cada vaquita es un `pot_id` acá adentro, no
//! una instancia aparte. Es lo que hace viable el camino de las wallets
//! custodiales de Pollar (Google/email): su backend valida cada autorización
//! contra una lista blanca de contratos por app, así que una dirección nueva por
//! vaquita exigiría tocar esa lista cada vez. Con una sola dirección se autoriza
//! una vez y sirve para todas.
//!
//! El contrato **no tiene dueño ni función de rescate**: ni quien lo despliega
//! puede sacar los fondos de ningún bote.
//!
//! Todo en testnet.

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, token, Address, Env};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// No existe un bote con ese id.
    NoSuchPot = 2,
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
    /// `refund` de un bote que alcanzó la meta y aún está en plazo de cobro.
    GoalWasReached = 9,
    /// `refund` de quien no aportó, o que ya retiró.
    NothingToRefund = 10,
    /// `claim` después del plazo de cobro: el bote pasó a ser de los aportantes.
    ClaimWindowClosed = 11,
}

#[contracttype]
#[derive(Clone)]
pub enum Key {
    /// El id que se le dará al próximo bote.
    NextId,
    /// Un bote. Persistente: hay tantos como vaquitas, no entran en `instance`.
    Pot(u32),
    /// Lo aportado por una dirección a un bote.
    Share(u32, Address),
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
/// El estado se renueva por 90 días en cada operación sobre el bote.
const TTL: u32 = DAY_LEDGERS * 90;
/// Tope del plazo: 60 días. Junto con GRACE entra holgado en el TTL, así que un
/// bote que nadie toca sigue teniendo estado vivo durante toda su vida útil.
const MAX_DEADLINE_SECS: u64 = 60 * 24 * 60 * 60;
/// Ventana del beneficiario para cobrar tras el plazo. Después, el bote vuelve
/// a los aportantes.
const GRACE_SECS: u64 = 15 * 24 * 60 * 60;

#[contract]
pub struct Vaquita;

#[contractimpl]
impl Vaquita {
    /// Abre un bote y devuelve su id. Los términos quedan fijos para siempre.
    ///
    /// No exige firma de nadie: un bote vacío no mueve plata y crear uno cuesta
    /// las comisiones de quien lo crea. Quién lo creó lo registra la app en su
    /// base; al contrato solo le importa a quién le toca cobrar.
    pub fn create_pot(
        env: Env,
        beneficiary: Address,
        token: Address,
        goal: i128,
        deadline: u64,
    ) -> Result<u32, Error> {
        let now = env.ledger().timestamp();
        if goal <= 0 || deadline <= now || deadline > now + MAX_DEADLINE_SECS {
            return Err(Error::InvalidTerms);
        }
        let id: u32 = env.storage().instance().get(&Key::NextId).unwrap_or(1);
        env.storage().instance().set(&Key::NextId, &(id + 1));
        env.storage().instance().extend_ttl(TTL, TTL);
        Self::save_pot(
            &env,
            id,
            &Pot { beneficiary, token, goal, deadline, raised: 0, claimed: false },
        );
        Ok(id)
    }

    /// Aporta `amount` al bote. El token sale de `from`, que debe autorizar.
    ///
    /// Aportar de nuevo suma a lo que esa dirección ya tenía: el reembolso
    /// después devuelve el total, no el último aporte.
    pub fn contribute(env: Env, pot_id: u32, from: Address, amount: i128) -> Result<i128, Error> {
        from.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let mut pot = Self::pot(&env, pot_id)?;
        if pot.claimed {
            return Err(Error::AlreadyClaimed);
        }
        if env.ledger().timestamp() > pot.deadline {
            return Err(Error::Expired);
        }

        // Estado primero y transferencia al final, igual que en claim y refund:
        // si el token falla, la invocación entera se revierte, así que escribir
        // antes no puede dejar el bote diciendo que recibió algo que no recibió.
        let share = Self::share_of(&env, pot_id, &from) + amount;
        pot.raised += amount;
        Self::save_share(&env, pot_id, &from, share);
        Self::save_pot(&env, pot_id, &pot);

        token::Client::new(&env, &pot.token).transfer(&from, &env.current_contract_address(), &amount);
        Ok(share)
    }

    /// El beneficiario se lleva todo el bote. Solo con la meta alcanzada y
    /// dentro del plazo de cobro (`deadline + GRACE`).
    ///
    /// No espera el `deadline`: alcanzada la meta, retener la plata no protege a
    /// nadie. `claimed` es lo que impide cobrar dos veces y cierra la puerta a
    /// cualquier reembolso posterior.
    pub fn claim(env: Env, pot_id: u32) -> Result<i128, Error> {
        let mut pot = Self::pot(&env, pot_id)?;
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
        Self::save_pot(&env, pot_id, &pot);
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
    pub fn refund(env: Env, pot_id: u32, to: Address) -> Result<i128, Error> {
        to.require_auth();
        let mut pot = Self::pot(&env, pot_id)?;
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
        let share = Self::share_of(&env, pot_id, &to);
        if share <= 0 {
            return Err(Error::NothingToRefund);
        }

        pot.raised -= share;
        env.storage().persistent().remove(&Key::Share(pot_id, to.clone()));
        Self::save_pot(&env, pot_id, &pot);
        token::Client::new(&env, &pot.token).transfer(&env.current_contract_address(), &to, &share);
        Ok(share)
    }

    /// Los términos y el total de un bote, para que la app muestre el progreso.
    pub fn state(env: Env, pot_id: u32) -> Result<Pot, Error> {
        Self::pot(&env, pot_id)
    }

    /// Lo aportado por una dirección (0 si no aportó o ya retiró).
    pub fn contributed(env: Env, pot_id: u32, who: Address) -> i128 {
        Self::share_of(&env, pot_id, &who)
    }

    /// Hasta cuándo puede cobrar el beneficiario; pasado eso, manda `refund`.
    pub fn claim_deadline(env: Env, pot_id: u32) -> Result<u64, Error> {
        Ok(Self::pot(&env, pot_id)?.deadline + GRACE_SECS)
    }

    fn pot(env: &Env, pot_id: u32) -> Result<Pot, Error> {
        env.storage().persistent().get(&Key::Pot(pot_id)).ok_or(Error::NoSuchPot)
    }

    fn save_pot(env: &Env, pot_id: u32, pot: &Pot) {
        env.storage().persistent().set(&Key::Pot(pot_id), pot);
        env.storage().persistent().extend_ttl(&Key::Pot(pot_id), TTL, TTL);
    }

    fn save_share(env: &Env, pot_id: u32, who: &Address, share: i128) {
        let key = Key::Share(pot_id, who.clone());
        env.storage().persistent().set(&key, &share);
        env.storage().persistent().extend_ttl(&key, TTL, TTL);
    }

    fn share_of(env: &Env, pot_id: u32, who: &Address) -> i128 {
        env.storage().persistent().get(&Key::Share(pot_id, who.clone())).unwrap_or(0)
    }
}

mod test;
