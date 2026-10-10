import { IAuthService, MockAuthService } from './authService';
import { IChatService, MockChatService } from './chatService';
import { ICommunityService, MockCommunityService } from './communityService';
import { IDmService, MockDmService } from './dmService';
import { ISettlementService, MockSettlementService } from './settlementService';
import { IWalletService, MockWalletService } from './walletService';
import { IProfileService, MockProfileService } from './profileService';
import { ISecurityService } from './securityService';
import { MockSecurityService } from './mockSecurityService';
import { IVaquitaService } from './vaquitaService';
import { MockVaquitaService } from './mockVaquitaService';
import { IPushService, MockPushService } from './pushService';
import { ApiPushService } from './api/push';
import { IRetosService } from './retosService';
import { MockRetosService } from './mockRetosService';
import { IAcademiaService } from './academiaService';
import { MockAcademiaService } from './mockAcademiaService';
import { IMiniAppService } from './miniappService';
import { MockMiniAppService } from './mockMiniappService';
import { IAttachmentService, MockAttachmentService } from './attachmentService';
import { ApiAttachmentService } from './api/attachments';
import {
  ApiAuthService,
  ApiChatService,
  ApiCommunityService,
  ApiDmService,
  ApiAcademiaService,
  ApiMiniAppService,
  ApiProfileService,
  ApiRetosService,
  ApiSecurityService,
  ApiVaquitaService,
  ApiWalletService,
} from './api';

/**
 * Service Gateway (Hexagonal Architecture)
 *
 * NEXT_PUBLIC_KOSMOVIA_SERVICES=api conecta la UI al backend de core (login
 * con Pollar, comunidades, chat y pagos reales en testnet). Sin esa variable,
 * todo sigue en modo demo con localStorage. Los cobros B2B (settlements)
 * siguen en demo en los dos modos: core todavía no los tiene.
 */
export const SERVICES_MODE: 'api' | 'mock' = process.env.NEXT_PUBLIC_KOSMOVIA_SERVICES === 'api' ? 'api' : 'mock';
const api = SERVICES_MODE === 'api';

export const authService: IAuthService = api ? new ApiAuthService() : new MockAuthService();
export const communityService: ICommunityService = api ? new ApiCommunityService() : new MockCommunityService();
export const chatService: IChatService = api ? new ApiChatService() : new MockChatService();
export const dmService: IDmService = api ? new ApiDmService() : new MockDmService();
export const walletService: IWalletService = api ? new ApiWalletService() : new MockWalletService();
export const settlementService: ISettlementService = new MockSettlementService();
export const profileService: IProfileService = api ? new ApiProfileService() : new MockProfileService();
export const securityService: ISecurityService = api ? new ApiSecurityService() : new MockSecurityService();
export const vaquitaService: IVaquitaService = api ? new ApiVaquitaService() : new MockVaquitaService();
export const pushService: IPushService = api ? new ApiPushService() : new MockPushService();
export const retosService: IRetosService = api ? new ApiRetosService() : new MockRetosService();
export const academiaService: IAcademiaService = api ? new ApiAcademiaService() : new MockAcademiaService();
export const miniappService: IMiniAppService = api ? new ApiMiniAppService() : new MockMiniAppService();
export const attachmentService: IAttachmentService = api ? new ApiAttachmentService() : new MockAttachmentService();

export * from './authService';
export * from './chatService';
export * from './communityService';
export * from './dmService';
export * from './settlementService';
export * from './walletService';
export * from './profileService';
export * from './securityService';
export * from './vaquitaService';
export * from './pushService';
export * from './miniappService';
export * from './attachmentService';
export * from './retosService';
export * from './academiaService';
export * from './storage';
export * from './mockData';
