#![no_std]

//! Vaquita con garantía: un bote colectivo que el contrato retiene.
//!
//! Hoy, en la app, cada aporte a una vaquita se paga directo a la wallet del
//! creador y la base solo anota quién puso cuánto. Si no se llega a la meta, no
//! hay forma de devolver nada: la promesa es social, no la respalda nada.
//!
//! Acá los aportes quedan en el contrato y solo salen de dos formas:
//!
//!   - se alcanzó la meta  -> `claim`, y solo el beneficiario;
//!   - venció el plazo sin alcanzarla -> `refund`, y cada quien retira lo suyo.
//!
//! Nunca las dos: `claim` cierra la vaquita y `refund` solo existe mientras no
//! se haya cobrado. El contrato no tiene dueño ni función de rescate: ni quien
//! lo despliega puede sacar los fondos por otro camino.
//!
//! Todo en testnet.

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, token, Address, Env};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// `init` ya corrió: los parámetros de una vaquita no se cambian.
    AlreadyInitialized = 1,
    NotInitialized = 2,
    /// Meta o plazo sin sentido (meta <= 0, plazo en el pasado).
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
    /// `refund` de una vaquita que sí alcanzó la meta: le toca `claim`.
    GoalWasReached = 9,
    /// `refund` de quien no aportó, o que ya retiró.
    NothingToRefund = 10,
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
    /// Quien recibe el bote si se alcanza la meta.
    pub beneficiary: Address,
    /// El token que se acepta (en la app, el USDC de testnet).
    pub token: Address,
    pub goal: i128,
    /// Segundos epoch; después de este instante no se aporta más.
    pub deadline: u64,
    pub raised: i128,
    /// El beneficiario ya cobró: la vaquita está terminada.
    pub claimed: bool,
}

const DAY: u32 = 17_280; // ~ledgers en 24 h, a 5 s por ledger
/// Se renueva por 30 días en cada uso: una vaquita viva no debe expirar sola.
const TTL: u32 = DAY * 30;

#[contract]
pub struct Vaquita;

#[contractimpl]
impl Vaquita {
    /// Fija los términos. Una sola vez, y es lo primero que corre tras desplegar.
    pub fn init(
        env: Env,
        beneficiary: Address,
        token: Address,
        goal: i128,
        deadline: u64,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&Key::Pot) {
            return Err(Error::AlreadyInitialized);
        }
        if goal <= 0 || deadline <= env.ledger().timestamp() {
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
        let mut pot = Self::pot(&env)?;
        if pot.claimed {
            return Err(Error::AlreadyClaimed);
        }
        if env.ledger().timestamp() > pot.deadline {
            return Err(Error::Expired);
        }

        // El movimiento del token va primero: si falla (saldo o trustline), el
        // contrato no queda diciendo que recibió algo que no recibió.
        token::Client::new(&env, &pot.token).transfer(&from, &env.current_contract_address(), &amount);

        let share = Self::share_of(&env, &from) + amount;
        pot.raised += amount;
        env.storage().persistent().set(&Key::Share(from.clone()), &share);
        env.storage().persistent().extend_ttl(&Key::Share(from), TTL, TTL);
        env.storage().instance().set(&Key::Pot, &pot);
        env.storage().instance().extend_ttl(TTL, TTL);
        Ok(share)
    }

    /// El beneficiario se lleva todo el bote. Solo si se alcanzó la meta.
    ///
    /// No espera el plazo: alcanzada la meta, retenerlo no protege a nadie. Y
    /// marca `claimed`, que es lo que impide cobrar dos veces y también cierra
    /// la puerta a cualquier reembolso posterior.
    pub fn claim(env: Env) -> Result<i128, Error> {
        let mut pot = Self::pot(&env)?;
        pot.beneficiary.require_auth();
        if pot.claimed {
            return Err(Error::AlreadyClaimed);
        }
        if pot.raised < pot.goal {
            return Err(Error::GoalNotReached);
        }

        let amount = pot.raised;
        pot.claimed = true;
        env.storage().instance().set(&Key::Pot, &pot);
        env.storage().instance().extend_ttl(TTL, TTL);
        token::Client::new(&env, &pot.token).transfer(
            &env.current_contract_address(),
            &pot.beneficiary,
            &amount,
        );
        Ok(amount)
    }

    /// Devuelve a `to` lo que aportó. Solo con el plazo vencido y la meta no
    /// alcanzada. El aporte se borra antes de transferir, así que no se puede
    /// cobrar dos veces ni por reentrada.
    pub fn refund(env: Env, to: Address) -> Result<i128, Error> {
        to.require_auth();
        let pot = Self::pot(&env)?;
        if pot.claimed {
            return Err(Error::AlreadyClaimed);
        }
        if env.ledger().timestamp() <= pot.deadline {
            return Err(Error::NotExpiredYet);
        }
        if pot.raised >= pot.goal {
            return Err(Error::GoalWasReached);
        }
        let share = Self::share_of(&env, &to);
        if share <= 0 {
            return Err(Error::NothingToRefund);
        }

        env.storage().persistent().remove(&Key::Share(to.clone()));
        token::Client::new(&env, &pot.token).transfer(&env.current_contract_address(), &to, &share);
        Ok(share)
    }

    /// Los términos y el total, para que la app muestre el progreso.
    pub fn state(env: Env) -> Result<Pot, Error> {
        Self::pot(&env)
    }

    /// Lo aportado por una dirección (0 si no aportó o ya retiró).
    pub fn contributed(env: Env, who: Address) -> i128 {
        Self::share_of(&env, &who)
    }

    fn pot(env: &Env) -> Result<Pot, Error> {
        env.storage().instance().get(&Key::Pot).ok_or(Error::NotInitialized)
    }

    fn share_of(env: &Env, who: &Address) -> i128 {
        env.storage().persistent().get(&Key::Share(who.clone())).unwrap_or(0)
    }
}

mod test;
