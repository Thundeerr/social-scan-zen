import { describe, it, expect, vi, afterEach } from "vitest";
import { distributeLinks } from "./smartlink-providers";
import { createProviderLink } from "./smartlink-providers.server";
afterEach(()=>vi.unstubAllEnvs());
describe("provider allocation",()=>{
 it("splits exact totals and assigns remainders",()=>{
  expect(distributeLinks(100,["a","b"]).map(p=>p.count)).toEqual([50,50]);
  expect(distributeLinks(100,["a","b","c","d"]).map(p=>p.count)).toEqual([25,25,25,25]);
  expect(distributeLinks(101,["a","b"]).map(p=>p.count)).toEqual([51,50]);
  expect(distributeLinks(1,["a","b"]).map(p=>p.count)).toEqual([1,0]);
  expect(distributeLinks(100,["a","a"])).toEqual([]);
 });
});
describe("provider adapters",()=>{
 it("does not call unconfigured providers",async()=>{
  vi.stubEnv("TINYURL_API_TOKEN","");
  const fetcher=vi.fn();
  expect(await createProviderLink("tinyurl","https://instascanner.app/s/test",fetcher)).toEqual({state:"failed",error:"not_configured"});
  expect(fetcher).not.toHaveBeenCalled();
 });
 it("uses the central redirect and extracts the TinyURL response",async()=>{
  vi.stubEnv("TINYURL_API_TOKEN","test-token");
  const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({data:{tiny_url:"https://tinyurl.com/abc"}})));
  expect((await createProviderLink("tinyurl","https://instascanner.app/s/test",fetcher)).url).toBe("https://tinyurl.com/abc");
  expect(JSON.parse(fetcher.mock.calls[0][1].body).url).toBe("https://instascanner.app/s/test");
 });
 it("uses Bitly group and default domain",async()=>{
  vi.stubEnv("BITLY_ACCESS_TOKEN","test"); vi.stubEnv("BITLY_GROUP_GUID","group");
  const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({link:"https://bit.ly/abc"})));
  expect((await createProviderLink("bitly","https://instascanner.app/s/test",fetcher)).state).toBe("ready");
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({group_guid:"group",domain:"bit.ly"});
 });
 it("stops on rate limits and does not retry",async()=>{
  vi.stubEnv("TINYURL_API_TOKEN","test");
  const fetcher=vi.fn().mockResolvedValue(new Response("limited",{status:429}));
  expect(await createProviderLink("tinyurl","https://instascanner.app/s/test",fetcher)).toEqual({state:"failed",error:"http_429"});
  expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it("marks lost responses uncertain instead of creating duplicates",async()=>{
  vi.stubEnv("TINYURL_API_TOKEN","test");
  const fetcher=vi.fn().mockRejectedValue(new Error("timeout"));
  expect((await createProviderLink("tinyurl","https://instascanner.app/s/test",fetcher)).state).toBe("uncertain");
  expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it("rejects unexpected returned domains",async()=>{
  vi.stubEnv("TINYURL_API_TOKEN","test");
  const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({data:{tiny_url:"https://example.com/abc"}})));
  expect((await createProviderLink("tinyurl","https://instascanner.app/s/test",fetcher)).state).toBe("uncertain");
 });
});

