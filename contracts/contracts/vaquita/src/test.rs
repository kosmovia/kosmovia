#![cfg(test)]

//! Lo que se prueba acá no es el camino feliz (eso es lo fácil), sino que la
//! plata no pueda salir por donde no debe: cobrar sin meta, cobrar dos veces,
//! reembolsar antes del plazo, reembolsar una vaquita que sí llegó, reembolsar
//! dos veces, y aportar después de vencido o cobrado.

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Env,
};

struct Setup {
    env: Env,
    client: VaquitaClient<'static>,
    token: token::Client<'static>,
    beneficiary: Address,
    ana: Address,
    beto: Address,
}

const GOAL: i128 = 100;
const DEADLINE: u64 = 1_000;

/// Vaquita con meta 100, plazo 1000, y dos aportantes con 500 cada uno.
fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 1);

    let admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let token_id = sac.address();
    let mint = token::StellarAssetClient::new(&env, &token_id);
    let token = token::Client::new(&env, &token_id);

    let beneficiary = Address::generate(&env);
    let ana = Address::generate(&env);
    let beto = Address::generate(&env);
    mint.mint(&ana, &500);
    mint.mint(&beto, &500);

    let contract_id = env.register(Vaquita, ());
    let client = VaquitaClient::new(&env, &contract_id);
    client.init(&beneficiary, &token_id, &GOAL, &DEADLINE);

    Setup { env, client, token, beneficiary, ana, beto }
}

// ------------------------------------------------------------------ términos

#[test]
fn init_solo_una_vez() {
    let s = setup();
    assert_eq!(
        s.client.try_init(&s.beneficiary, &s.token.address, &GOAL, &DEADLINE),
        Err(Ok(Error::AlreadyInitialized)),
    );
}

#[test]
fn init_rechaza_terminos_sin_sentido() {
    let env = Env::default();
    env.ledger().with_mut(|l| l.timestamp = 100);
    let who = Address::generate(&env);
    let client = VaquitaClient::new(&env, &env.register(Vaquita, ()));
    // Meta cero y plazo ya vencido.
    assert_eq!(client.try_init(&who, &who, &0, &200), Err(Ok(Error::InvalidTerms)));
    assert_eq!(client.try_init(&who, &who, &100, &50), Err(Ok(Error::InvalidTerms)));
}

// ------------------------------------------------------------------ aportes

#[test]
fn aportar_mueve_el_token_al_contrato_y_acumula() {
    let s = setup();
    assert_eq!(s.client.contribute(&s.ana, &30), 30);
    // Aportar de nuevo suma: el reembolso devuelve el total, no el último.
    assert_eq!(s.client.contribute(&s.ana, &20), 50);
    assert_eq!(s.client.contributed(&s.ana), 50);
    assert_eq!(s.client.state().raised, 50);
    assert_eq!(s.token.balance(&s.ana), 450);
    assert_eq!(s.token.balance(&s.client.address), 50);
}

#[test]
fn no_se_aporta_cero_ni_negativo() {
    let s = setup();
    assert_eq!(s.client.try_contribute(&s.ana, &0), Err(Ok(Error::InvalidAmount)));
    assert_eq!(s.client.try_contribute(&s.ana, &-5), Err(Ok(Error::InvalidAmount)));
}

#[test]
fn no_se_aporta_despues_del_plazo() {
    let s = setup();
    s.env.ledger().with_mut(|l| l.timestamp = DEADLINE + 1);
    assert_eq!(s.client.try_contribute(&s.ana, &10), Err(Ok(Error::Expired)));
}

#[test]
fn no_se_aporta_despues_de_cobrada() {
    let s = setup();
    s.client.contribute(&s.ana, &GOAL);
    s.client.claim();
    assert_eq!(s.client.try_contribute(&s.beto, &10), Err(Ok(Error::AlreadyClaimed)));
}

// ------------------------------------------------------------------ cobro

#[test]
fn el_beneficiario_cobra_al_alcanzar_la_meta_sin_esperar_el_plazo() {
    let s = setup();
    s.client.contribute(&s.ana, &60);
    s.client.contribute(&s.beto, &40);
    assert_eq!(s.client.claim(), 100);
    assert_eq!(s.token.balance(&s.beneficiary), 100);
    assert_eq!(s.token.balance(&s.client.address), 0);
    assert!(s.client.state().claimed);
}

#[test]
fn no_se_cobra_sin_alcanzar_la_meta() {
    let s = setup();
    s.client.contribute(&s.ana, &99);
    assert_eq!(s.client.try_claim(), Err(Ok(Error::GoalNotReached)));
    assert_eq!(s.token.balance(&s.beneficiary), 0);
}

#[test]
fn no_se_cobra_dos_veces() {
    let s = setup();
    s.client.contribute(&s.ana, &GOAL);
    s.client.claim();
    assert_eq!(s.client.try_claim(), Err(Ok(Error::AlreadyClaimed)));
    // Y el bote no quedó con saldo para un segundo cobro.
    assert_eq!(s.token.balance(&s.client.address), 0);
}

#[test]
fn un_aporte_de_mas_se_cobra_completo() {
    let s = setup();
    s.client.contribute(&s.ana, &150);
    assert_eq!(s.client.claim(), 150);
    assert_eq!(s.token.balance(&s.beneficiary), 150);
}

// ------------------------------------------------------------------ reembolso

#[test]
fn vencido_sin_meta_cada_quien_retira_lo_suyo() {
    let s = setup();
    s.client.contribute(&s.ana, &30);
    s.client.contribute(&s.beto, &20);
    s.env.ledger().with_mut(|l| l.timestamp = DEADLINE + 1);

    assert_eq!(s.client.refund(&s.ana), 30);
    assert_eq!(s.client.refund(&s.beto), 20);
    assert_eq!(s.token.balance(&s.ana), 500);
    assert_eq!(s.token.balance(&s.beto), 500);
    assert_eq!(s.token.balance(&s.client.address), 0);
}

#[test]
fn no_se_reembolsa_antes_del_plazo() {
    let s = setup();
    s.client.contribute(&s.ana, &30);
    assert_eq!(s.client.try_refund(&s.ana), Err(Ok(Error::NotExpiredYet)));
}

#[test]
fn no_se_reembolsa_si_la_meta_se_alcanzo() {
    let s = setup();
    s.client.contribute(&s.ana, &GOAL);
    s.env.ledger().with_mut(|l| l.timestamp = DEADLINE + 1);
    // Aunque venza el plazo: la meta se alcanzó, le toca cobrar al beneficiario.
    assert_eq!(s.client.try_refund(&s.ana), Err(Ok(Error::GoalWasReached)));
}

#[test]
fn no_se_reembolsa_dos_veces() {
    let s = setup();
    s.client.contribute(&s.ana, &30);
    s.env.ledger().with_mut(|l| l.timestamp = DEADLINE + 1);
    s.client.refund(&s.ana);
    assert_eq!(s.client.try_refund(&s.ana), Err(Ok(Error::NothingToRefund)));
    assert_eq!(s.token.balance(&s.ana), 500);
}

#[test]
fn quien_no_aporto_no_retira_nada() {
    let s = setup();
    s.client.contribute(&s.ana, &30);
    s.env.ledger().with_mut(|l| l.timestamp = DEADLINE + 1);
    assert_eq!(s.client.try_refund(&s.beto), Err(Ok(Error::NothingToRefund)));
}

#[test]
fn cobrada_no_deja_reembolsar_aunque_pase_el_plazo() {
    let s = setup();
    s.client.contribute(&s.ana, &GOAL);
    s.client.claim();
    s.env.ledger().with_mut(|l| l.timestamp = DEADLINE + 1);
    assert_eq!(s.client.try_refund(&s.ana), Err(Ok(Error::AlreadyClaimed)));
}

// ------------------------------------------------------------------ permisos

#[test]
fn sin_autorizacion_no_se_mueve_nada() {
    let s = setup();
    s.client.contribute(&s.ana, &10);

    // Se arma con permisos (acuñar y aportar los necesitan) y recién acá se
    // exige autorización de verdad: sin firma, nadie mueve plata ajena.
    s.env.set_auths(&[]);
    assert!(s.client.try_contribute(&s.ana, &10).is_err());
    // Y nadie puede cobrar haciéndose pasar por el beneficiario.
    assert!(s.client.try_claim().is_err());
    assert_eq!(s.token.balance(&s.client.address), 10);
}

#[test]
fn sin_init_no_se_puede_operar() {
    let env = Env::default();
    env.mock_all_auths();
    let who = Address::generate(&env);
    let client = VaquitaClient::new(&env, &env.register(Vaquita, ()));
    assert_eq!(client.try_state(), Err(Ok(Error::NotInitialized)));
    assert_eq!(client.try_contribute(&who, &10), Err(Ok(Error::NotInitialized)));
    assert_eq!(client.try_claim(), Err(Ok(Error::NotInitialized)));
    assert_eq!(client.try_refund(&who), Err(Ok(Error::NotInitialized)));
}
