import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { CAMPAIGN_MEDIA_ID as MEDIA, COMMENT_CAMPAIGN_VERSION } from "./kiikii-comment-campaigns";
import { KIIKII_ID } from "./kiikii-dm-redirect";
const mock = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: mock }));
import { campaignOperator, ingestCampaignComments, campaignPoll } from "./kiikii-comment-campaigns.server";
import { webhookSummary } from "./instagram-webhook-health.server";
import { dmWebhook } from "./reel-inbox-dm.server";

const SENDER="1569413477836896", COMMENT="18473482705191162", INTRO="heyy, you wanted a closer look? 👀 say hi here 💚";
let campaign:any, dm:any, conn:any, receipt:any, verified:any, provider:any, page:any, roles:any, subscriptions:string[], claim:any, finish:boolean;
const payload=(patch={})=>({object:"instagram",entry:[{id:KIIKII_ID,changes:[{field:"comments",value:{id:COMMENT,from:{id:SENDER,username:"visitor"},media:{id:MEDIA},text:"<3",...patch}}]}]});
function data(table:string) {return table==="ig_comment_campaigns"?campaign:table==="ig_dm_redirect_settings"?dm:table==="ig_connections"?conn:table==="user_roles"?roles:receipt;}
beforeEach(()=>{
  vi.resetAllMocks();vi.stubEnv("INSTAGRAM_WEBHOOK_APP_SECRET","test-secret");vi.spyOn(console,"error").mockImplementation(()=>{});
  campaign={id:"campaign",user_id:"owner",media_id:MEDIA,enabled:true,starts_at:new Date(Date.now()-3*86400000).toISOString(),reply_text:INTRO,backfill_revision:0,backfill_cursor:null,backfill_cursor_hashes:[],backfill_complete_at:null};
  dm={user_id:"owner",mode:"off"};roles=[{role:"owner"}];receipt=null;subscriptions=["messages","comments","messaging_seen"];
  conn={ig_user_id:KIIKII_ID,ig_username:"kiikii.bat",page_access_token:"fake-secret",granted_scopes:["instagram_business_manage_messages","instagram_business_manage_comments"],token_expires_at:new Date(Date.now()+86400000).toISOString(),status:"active"};
  verified={id:COMMENT,from:{username:"visitor"},media:{id:MEDIA},text:"<3",timestamp:new Date().toISOString(),hidden:false};
  provider={message_id:"accepted",recipient_id:SENDER};page={data:[]};
  claim={authorized:true,claimed:true,lease:"lease-1",cursor:null,cursorHashes:[]};finish=true;
  mock.from.mockImplementation((table:string)=>{
    const q:any={then:(ok:any)=>Promise.resolve({data:table==="ig_dm_redirect_receipts"?(receipt?[receipt]:[]):data(table),error:null}).then(ok)};
    for(const method of ["select","eq","order","limit"]) q[method]=vi.fn(()=>q);
    q.maybeSingle=vi.fn(async()=>({data:data(table),error:null}));
    q.update=vi.fn((patch:any)=>{if(table==="ig_comment_campaigns")Object.assign(campaign,patch);if(table==="ig_dm_redirect_receipts")receipt={...receipt,...patch};return q;});
    return q;
  });
  mock.rpc.mockImplementation(async(name)=>{if(name==="ig_webhook_note")return{data:null,error:null};if(name==="ig_comment_campaign_poll_claim")return{data:claim,error:null};if(name==="ig_comment_campaign_poll_finish")return{data:finish,error:null};receipt={message_hash:"reserved",status:"reserved"};return{data:{send:true,reply_text:INTRO},error:null};});
  vi.stubGlobal("fetch",vi.fn(async(input:any,options:any)=>{
    const url=String(input);
    if(url.includes("/subscribed_apps")){if(options?.method==="POST"){subscriptions=["messages","comments","messaging_seen"];return Response.json({success:true});}return Response.json({data:[{subscribed_fields:subscriptions}]});}
    if(url.includes(`/${MEDIA}/comments?`))return Response.json(page);
    if(url.includes("/me?"))return Response.json({id:"28348803094791726",user_id:KIIKII_ID,username:"kiikii.bat"});
    if(url.includes(`/${MEDIA}?`))return Response.json({id:MEDIA,owner:{id:"28348803094791726"},media_product_type:"REELS",permalink:"https://www.instagram.com/reel/DfiEPHSAo7k/"});
    if(url.includes(`/${COMMENT}?`))return Response.json(verified);
    if(url.endsWith("/messages"))return Response.json(provider);
    throw new Error("Unexpected network operation");
  }));
});
describe("authenticated recurring campaign poll",()=>{
  const request=(token="a".repeat(64),method="POST")=>new Request("https://instascanner.app/api/public/instagram/comment-campaign-poll",{method,headers:{authorization:`Bearer ${token}`},...(method==="POST"?{body:JSON.stringify({mediaId:"999",enable:true})}:{})});
  it("requires POST and a correctly shaped existing worker credential",async()=>{expect((await campaignPoll(request("x","GET"))).status).toBe(405);expect((await campaignPoll(request("wrong"))).status).toBe(401);expect(mock.rpc).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();});
  it("never reads Instagram for an unauthorized hash",async()=>{claim={authorized:false};expect((await campaignPoll(request())).status).toBe(401);expect(fetch).not.toHaveBeenCalled();expect(mock.rpc.mock.calls[0][1].p_worker_hash).not.toBe("a".repeat(64));});
  it.each(["paused","busy","rate_limited"])("returns a safe %s state without provider calls",async reason=>{claim={authorized:true,claimed:false,reason,lastSuccessfulPollAt:null};expect(await(await campaignPoll(request())).json()).toEqual({ok:true,processed:false,reason,lastSuccessfulPollAt:null});expect(fetch).not.toHaveBeenCalled();});
  it("ignores body overrides, reads only the fixed reel and resets cursor at EOF",async()=>{expect((await campaignPoll(request())).status).toBe(200);expect(vi.mocked(fetch).mock.calls.every(([url])=>String(url).includes(`/${MEDIA}/comments?`))).toBe(true);expect(mock.rpc).toHaveBeenCalledWith("ig_comment_campaign_poll_finish",{p_lease:"lease-1",p_cursor:null,p_cursor_hashes:[],p_error:null});expect(dm.mode).toBe("off");});
  it("performs one intro for a qualifying page and deduplicates later poll replay",async()=>{page={data:[{id:COMMENT,from:{id:SENDER,username:"visitor"}}]};expect((await campaignPoll(request())).status).toBe(200);expect((await campaignPoll(request())).status).toBe(200);expect(sends()).toHaveLength(1);});
  it("fences a lost lease instead of reporting a healthy poll",async()=>{finish=false;expect((await campaignPoll(request())).status).toBe(503);expect(mock.rpc.mock.calls.filter(([name])=>name==="ig_comment_campaign_poll_finish")).toHaveLength(1);});
  it("recovers a rejected saved cursor through a successful fixed-head probe",async()=>{claim.cursor="expired";claim.cursorHashes=["f".repeat(64)];const previous=vi.mocked(fetch).getMockImplementation()!;vi.mocked(fetch).mockImplementation(async(input,options)=>String(input).includes("after=expired")?Response.json({error:{code:100}},{status:400}):previous(input,options));expect((await campaignPoll(request())).status).toBe(200);expect(mock.rpc).toHaveBeenCalledWith("ig_comment_campaign_poll_finish",{p_lease:"lease-1",p_cursor:null,p_cursor_hashes:[],p_error:null});expect(sends()).toHaveLength(0);});
  it("preserves saved traversal when both cursor read and head probe fail",async()=>{claim.cursor="cursor";vi.mocked(fetch).mockResolvedValue(Response.json({error:{code:2}},{status:500}));expect((await campaignPoll(request())).status).toBe(503);expect(mock.rpc).toHaveBeenCalledWith("ig_comment_campaign_poll_finish",expect.objectContaining({p_error:"poll_failed"}));expect(sends()).toHaveLength(0);});
  it("rejects malformed continuation before any private send",async()=>{page={data:[{id:COMMENT,from:{id:SENDER,username:"visitor"}}],paging:{next:"https://ignored-token-url"}};expect((await campaignPoll(request())).status).toBe(503);expect(mock.rpc).toHaveBeenCalledWith("ig_comment_campaign_poll_finish",expect.objectContaining({p_error:"invalid_cursor"}));expect(sends()).toHaveLength(0);});
  it("surfaces a failed delivery and never repeats its POST",async()=>{page={data:[{id:COMMENT,from:{id:SENDER,username:"visitor"}}]};provider={error:{code:10}};expect((await campaignPoll(request())).status).toBe(503);expect(mock.rpc).toHaveBeenCalledWith("ig_comment_campaign_poll_finish",expect.objectContaining({p_error:"delivery_failed"}));expect((await campaignPoll(request())).status).toBe(200);expect(sends()).toHaveLength(1);});
});
describe("bounded webhook diagnostics",()=>{
  it("records only bounded routing metadata without body text, sender identity or credentials",()=>{const body=payload({text:"PRIVATE_CONTENT",from:{id:SENDER,username:"PRIVATE_USER"},access_token:"PRIVATE_SECRET"});const summary=webhookSummary(body);expect(summary).toEqual({object:"instagram",entry_ids:[KIIKII_ID],fields:["comments"],media_ids:[MEDIA],parsed_comments:1,target_comments:1});expect(JSON.stringify(summary)).not.toMatch(/PRIVATE|1569413477836896/);});
  it("reveals a mismatched entry identifier without accepting it",()=>{const body=payload();body.entry[0].id="28348803094791726";expect(webhookSummary(body)).toMatchObject({entry_ids:["28348803094791726"],parsed_comments:0,target_comments:0});});
});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.restoreAllMocks();});
const sends=()=>vi.mocked(fetch).mock.calls.filter(([url])=>String(url).endsWith("/messages"));

describe("scoped comment webhook",()=>{
  it("sends the campaign intro for an ordinary visitor while the old DM responder stays off",async()=>{
    await ingestCampaignComments(payload());expect(sends()).toHaveLength(1);
    expect(JSON.parse(sends()[0][1]!.body as string)).toEqual({recipient:{comment_id:COMMENT},message:{text:INTRO}});
    expect(receipt.status).toBe("sent");expect(dm.mode).toBe("off");expect(campaign.last_webhook_at).toBeTruthy();
  });
  it("records actual webhook arrival even for already handled comments",async()=>{receipt={message_hash:"existing",status:"sent"};await ingestCampaignComments(payload());expect(campaign.last_webhook_at).toBeTruthy();expect(fetch).not.toHaveBeenCalled();});
  it("ignores other reels before any database or provider access",async()=>{await ingestCampaignComments(payload({media:{id:"99"}}));expect(mock.from).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();});
  it("records disabled-campaign transport without sending",async()=>{campaign.enabled=false;await ingestCampaignComments(payload());expect(campaign.last_webhook_at).toBeTruthy();expect(fetch).not.toHaveBeenCalled();});
  it("blocks when the old DM responder becomes active",async()=>{dm.mode="live";await expect(ingestCampaignComments(payload())).rejects.toThrow();expect(sends()).toHaveLength(0);expect(campaign.last_error_code).toBe("connection_not_ready");});
  it.each([{text:"love this <3"},{hidden:true},{parent_id:"99"},{media:{id:"99"}},{from:{username:"other"}},{from:{id:"22",username:"visitor"}},{timestamp:new Date(Date.now()-8*86400000).toISOString()}])("rejects ineligible re-read data %j",async patch=>{Object.assign(verified,patch);await ingestCampaignComments(payload());expect(sends()).toHaveLength(0);expect(mock.rpc).not.toHaveBeenCalled();});
  it("allows a two-day-old original comment inside the campaign's seven-day window",async()=>{verified.timestamp=new Date(Date.now()-2*86400000).toISOString();await ingestCampaignComments(payload());expect(sends()).toHaveLength(1);});
  it("never sends if the durable reservation fails",async()=>{mock.rpc.mockResolvedValue({data:null,error:{message:"database unavailable"}});await expect(ingestCampaignComments(payload())).rejects.toThrow();expect(sends()).toHaveLength(0);});
  it("does not resend after an unknown HTTP outcome",async()=>{const previous=vi.mocked(fetch).getMockImplementation()!;vi.mocked(fetch).mockImplementation(async(input,options)=>String(input).endsWith("/messages")?Promise.reject(new Error("network")):previous(input,options));await ingestCampaignComments(payload());expect(receipt.status).toBe("uncertain");await ingestCampaignComments(payload());expect(sends()).toHaveLength(1);});
  it.each([{message_id:""},{message_id:"  "},{message_id:"x",recipient_id:"other"},{message_id:"x",error:{code:10}}])("does not mark a bad provider receipt as sent %j",async result=>{provider=result;await ingestCampaignComments(payload());expect(receipt.status).toBe("uncertain");});
  it("normalizes edge whitespace before the SQL reservation",async()=>{verified.text="\n<3\t";await ingestCampaignComments(payload());expect(mock.rpc).toHaveBeenCalledWith("ig_comment_campaign_reserve",expect.objectContaining({p_text:"<3"}));expect(sends()).toHaveLength(1);});
  it("is wired behind the shared signature check and exposes a code version",async()=>{
    const raw=JSON.stringify(payload());const req=(signature:string)=>new Request("https://instascanner.app/api/public/instagram/inbox-webhook",{method:"POST",body:raw,headers:{"x-hub-signature-256":signature}});
    const bad=await dmWebhook(req("sha256="+"0".repeat(64)));expect(bad.status).toBe(403);expect(fetch).not.toHaveBeenCalled();
    const good=await dmWebhook(req("sha256="+createHmac("sha256","test-secret").update(raw).digest("hex")));expect(good.status).toBe(200);expect(good.headers.get("x-kiikii-comment-campaign-version")).toBe(COMMENT_CAMPAIGN_VERSION);expect(sends()).toHaveLength(1);
  });
});
describe("campaign owner operations",()=>{
  it("rejects non-owners before reading credentials",async()=>{roles=[{role:"member"}];await expect(campaignOperator("other","enable")).rejects.toThrow("Not authorized");expect(mock.from).toHaveBeenCalledTimes(1);expect(fetch).not.toHaveBeenCalled();});
  it("preserves account subscription fields and leaves legacy DM off",async()=>{campaign.enabled=false;subscriptions=["messages","messaging_seen"];const result=await campaignOperator("owner","enable");expect(result.campaign?.enabled).toBe(true);expect(result.accountSubscribedFields).toEqual(expect.arrayContaining(["messages","comments","messaging_seen"]));expect(dm.mode).toBe("off");expect(sends()).toHaveLength(0);});
  it("catches up a page through the same verifier and stores only its opaque cursor",async()=>{page={data:[{id:COMMENT,from:{id:SENDER,username:"visitor"}}],paging:{next:"https://graph.instagram.com/secret?access_token=DO_NOT_USE",cursors:{after:"opaque-cursor"}}};await campaignOperator("owner","catchup");expect(sends()).toHaveLength(1);expect(campaign.backfill_cursor).toBe("opaque-cursor");expect(campaign.last_webhook_at).toBeUndefined();expect(campaign.last_catchup_at).toBeTruthy();expect(vi.mocked(fetch).mock.calls.every(([url])=>!String(url).includes("DO_NOT_USE"))).toBe(true);});
  it("finishes an empty final page without a pagination cap",async()=>{campaign.backfill_cursor="page999";const result=await campaignOperator("owner","catchup");expect(result.campaign?.backfillComplete).toBe(true);expect(campaign.backfill_cursor).toBeNull();});
  it("does not advance an invalid page or send its comments",async()=>{page={data:[{id:COMMENT,from:{id:SENDER,username:"visitor"}}],paging:{next:"https://ignored"}};await expect(campaignOperator("owner","catchup")).rejects.toThrow();expect(campaign.backfill_revision).toBe(0);expect(sends()).toHaveLength(0);});
});
