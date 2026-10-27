import { beforeEach,describe,it,expect,vi } from 'vitest';
const mocks=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn(),send:vi.fn()}));
vi.mock('@/integrations/supabase/client.server',()=>({supabaseAdmin:{rpc:mocks.rpc,from:mocks.from}}));
vi.mock('./messaging/telegram-transport',()=>({channelAlertTelegramCall:mocks.send}));
import {sendBusinessReport,businessWebhook,businessTick} from './business-report.server';
describe('report delivery boundaries',()=>{
  beforeEach(()=>{vi.resetAllMocks();vi.stubEnv('CONTENT_REVIEW_OWNER_ID','owner');vi.stubEnv('CONTENT_REVIEW_TELEGRAM_CHAT_ID','12345');vi.stubEnv('CONTENT_REVIEW_BOT_TOKEN','test');});
  it('does not send another user report',async()=>{await expect(sendBusinessReport('other','test','x')).rejects.toThrow();expect(mocks.from).not.toHaveBeenCalled();});
  it('does not resend reserved/ambiguous deliveries',async()=>{mocks.from.mockReturnValue({insert:vi.fn().mockResolvedValue({error:{code:'23505'}})});await expect(sendBusinessReport('owner','daily:x','x')).resolves.toEqual({duplicate:true});expect(mocks.send).not.toHaveBeenCalled();});
  it('marks timeout uncertain, never retries send',async()=>{
    const eq2=vi.fn().mockResolvedValue({error:null,data:null}),eq1=vi.fn().mockReturnValue({eq:eq2}),update=vi.fn().mockReturnValue({eq:eq1});
    mocks.from.mockReturnValue({insert:vi.fn().mockResolvedValue({error:null}),update});mocks.send.mockResolvedValue({ok:false,status:0});
    await expect(sendBusinessReport('owner','daily:x','x')).rejects.toThrow('unbestätigt');
    expect(mocks.send).toHaveBeenCalledTimes(1);expect(update).toHaveBeenCalledWith({state:'uncertain',message_id:null});
  });
  it('rejects unsigned webhook before touching database',async()=>{const r=await businessWebhook(new Request('https://test',{method:'POST',body:'{}'}));expect(r.status).toBe(401);expect(mocks.from).not.toHaveBeenCalled();});
  it('rejects invalid cron secret',async()=>{mocks.rpc.mockResolvedValue({data:false,error:null});expect((await businessTick(new Request('https://test',{method:'POST',headers:{'x-cron-secret':'bad'}}))).status).toBe(401);expect(mocks.from).not.toHaveBeenCalled();});
});
