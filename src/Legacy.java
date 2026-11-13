import com.sun.net.httpserver.*;
import java.io.*;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.util.*;

/** Original views run on one Java service. Live EM remains an explicitly configured legacy connector. */
final class Legacy {
    final String mode;
    private final URI upstream;
    private final HttpClient client=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).followRedirects(HttpClient.Redirect.NEVER).build();
    private final Map<String,Object> demos;
    private final Map<String,Map<String,Object>> results=new LinkedHashMap<>();
    Legacy()throws IOException{
        mode=HttpUtil.env("XT_LEGACY_MODE","disabled");if(!Set.of("demo","disabled","upstream").contains(mode))throw new IllegalArgumentException("XT_LEGACY_MODE 仅支持 disabled/demo/upstream");
        demos=HttpUtil.object(Json.parse(new String(HttpUtil.resource("/fixtures/demo.json"),StandardCharsets.UTF_8)));
        if(mode.equals("upstream")){upstream=URI.create(HttpUtil.env("XT_LEGACY_URL","http://127.0.0.1:8787"));if(!Set.of("http","https").contains(upstream.getScheme())||upstream.getHost()==null||upstream.getRawUserInfo()!=null||upstream.getRawQuery()!=null||upstream.getRawFragment()!=null||!upstream.getPath().isEmpty())throw new IllegalArgumentException("XT_LEGACY_URL 需要无路径的 HTTP(S) 服务地址");}else upstream=null;
    }
    boolean path(String path){return path.startsWith("/api/live/")||path.startsWith("/api/observability/")||path.equals("/api/investigations")||path.startsWith("/api/investigations/")||path.startsWith("/api/snapshots/")||path.equals("/api/snapshots");}
    private boolean allowed(String path,String method){return method.equals("GET")&&(Set.of("/api/live/status","/api/live/snapshot","/api/observability/sources","/api/snapshots","/api/snapshots/diff").contains(path)||path.matches("/api/snapshots/[a-zA-Z0-9._-]{1,160}")||path.matches("/api/investigations/[a-zA-Z0-9._-]{1,160}(/report)?"))||method.equals("POST")&&Set.of("/api/investigations","/api/snapshots/capture").contains(path);}
    void handle(HttpExchange ex,String path)throws IOException{
        if(!allowed(path,ex.getRequestMethod()))throw HttpUtil.problem(404,"NOT_FOUND","没有此功能接口");
        if(mode.equals("upstream")){proxy(ex);return;}
        if(path.equals("/api/live/status")){HttpUtil.send(ex,200,HttpUtil.map("mode",mode.equals("demo")?"demo":"unconfigured","configured",mode.equals("demo"),"hostsMasked",true,"captureEnabled",false,"observabilityMode",mode.equals("demo")?"demo":"unavailable","notice",mode.equals("demo")?"内置脱敏演示，未接客户环境":"尚未配置真实 EM 连接器"));return;}
        if(path.equals("/api/observability/sources")){HttpUtil.send(ex,200,mode.equals("demo")?demos.get("sources"):HttpUtil.map("sources",List.of(HttpUtil.map("id","unavailable","name","真实日志/Trace 未接入","mode","unavailable","configured",false,"notice","尚无真实日志/APM 适配器")),"presets",List.of()));return;}
        if(!mode.equals("demo"))throw HttpUtil.problem(503,"SOURCE_NOT_CONFIGURED","真实 EM / 日志数据源尚未配置；不会回退演示数据");
        if(path.equals("/api/live/snapshot")){HttpUtil.send(ex,200,HttpUtil.object(demos.get("snapshots")).get("demo-current"));return;}
        if(path.equals("/api/snapshots")){HttpUtil.send(ex,200,HttpUtil.map("snapshots",demos.get("summaries")));return;}
        if(path.equals("/api/snapshots/capture"))throw HttpUtil.problem(409,"DEMO_READ_ONLY","演示只提供两份固定回放快照，不生成伪现场采集记录");
        if(path.equals("/api/snapshots/diff")){Map<String,String> q=HttpUtil.query(ex);if(!q.containsKey("from")||!q.containsKey("to"))throw HttpUtil.problem(400,"PAIR_REQUIRED","请选择两份回放快照");Object diff=HttpUtil.object(demos.get("diffs")).get(q.get("from")+"|"+q.get("to"));if(diff==null)throw HttpUtil.problem(404,"NO_SNAPSHOT","找不到此回放快照");HttpUtil.send(ex,200,diff);return;}
        if(path.startsWith("/api/snapshots/")){Object snap=HttpUtil.object(demos.get("snapshots")).get(path.substring(15));if(snap==null)throw HttpUtil.problem(404,"NO_SNAPSHOT","找不到此回放快照");HttpUtil.send(ex,200,snap);return;}
        if(path.equals("/api/investigations")){investigate(ex);return;}
        synchronized(results){long now=System.currentTimeMillis();results.entrySet().removeIf(e->Instant.parse((String)e.getValue().get("expiresAt")).toEpochMilli()<now);String[] parts=path.substring("/api/investigations/".length()).split("/");Map<String,Object> found=results.get(parts[0]);if(found==null)throw HttpUtil.problem(404,"NO_RESULT","定位回放不存在或已过期");if(parts.length==2)HttpUtil.bytes(ex,200,((String)found.get("reportMarkdown")).getBytes(StandardCharsets.UTF_8),"text/markdown; charset=utf-8");else HttpUtil.send(ex,200,found);}
    }
    private void investigate(HttpExchange ex)throws IOException{
        Map<String,Object> input=HttpUtil.jsonBody(ex,4096);HttpUtil.fields(input,"query","scenario","windowMinutes","queryType");
        for(String k:List.of("query","scenario","queryType"))if(input.containsKey(k)&&(!(input.get(k) instanceof String)||((String)input.get(k)).length()>(k.equals("query")?240:120)))throw HttpUtil.problem(400,"INVALID_QUERY","查询参数无效");
        Object win=input.getOrDefault("windowMinutes",15);if(!(win instanceof Number)||!List.of(15.0,60.0,120.0).contains(((Number)win).doubleValue()))throw HttpUtil.problem(400,"INVALID_WINDOW","仅支持 15/60/120 分钟");
        String scenario=(String)input.getOrDefault("scenario",""),query=((String)input.getOrDefault("query","")).trim().toLowerCase(Locale.ROOT);if(scenario.isEmpty()&&query.isEmpty())throw HttpUtil.problem(400,"QUERY_REQUIRED","请输入关联 ID 或选择演示场景");
        Map<String,Object> examples=HttpUtil.object(demos.get("investigations"));Object selected=examples.get(scenario);
        if(scenario.isEmpty()){List<Object> matches=new ArrayList<>();for(Object item:examples.values()){Map<String,Object> candidate=HttpUtil.object(item);String search=Json.stringify(HttpUtil.map("scope",candidate.get("queryScope"),"spans",candidate.get("spans"),"logs",candidate.get("logs"))).toLowerCase(Locale.ROOT);if(query.length()>=3&&search.contains(query))matches.add(item);}if(matches.size()>1)throw HttpUtil.problem(409,"OBSERVABILITY_AMBIGUOUS","匹配多个演示链路，请选择具体场景");if(matches.size()==1)selected=matches.get(0);}
        if(selected==null)throw HttpUtil.problem(404,"OBSERVABILITY_NO_MATCH","内置演示中没有匹配项");
        Map<String,Object> result=HttpUtil.object(Json.parse(Json.stringify(selected)));String id="replay-"+UUID.randomUUID();result.put("id",id);result.put("expiresAt",Instant.now().plusSeconds(1800).toString());result.put("replay",true);result.put("notice","固定脱敏回放；证据时间与评分来自构建时的原版演示引擎，不表示现场实时查询");
        // Preserve original evidence timestamps and query window; never pretend replay was just collected.
        synchronized(results){while(results.size()>=20)results.remove(results.keySet().iterator().next());results.put(id,result);}HttpUtil.audit("investigation.replay","ok");HttpUtil.send(ex,201,result);
    }
    private void proxy(HttpExchange ex)throws IOException{
        String raw=ex.getRequestURI().getRawPath();if(raw.contains("%"))throw HttpUtil.problem(400,"INVALID_PATH","接口路径不接受编码变体");
        URI url=URI.create(upstream.toString()+ex.getRequestURI().toASCIIString());HttpRequest.Builder request=HttpRequest.newBuilder(url).timeout(Duration.ofSeconds(12)).header("Accept","application/json").header("X-Forwarded-User","xingtu-shared-operator");
        if(ex.getRequestMethod().equals("POST")){String action=ex.getRequestURI().getPath().equals("/api/investigations")?"investigate":"capture";request.header("X-Xingtu-Action",action).header("Content-Type","application/json");Map<String,Object> body=HttpUtil.jsonBody(ex,4096);request.POST(HttpRequest.BodyPublishers.ofString(Json.stringify(body)));}else request.GET();
        try{HttpResponse<InputStream> response=client.send(request.build(),HttpResponse.BodyHandlers.ofInputStream());try(InputStream in=response.body()){byte[] data=in.readNBytes(1048577);if(data.length>1048576)throw HttpUtil.problem(502,"UPSTREAM_TOO_LARGE","旧连接器响应超过 1MB");if(response.statusCode()>=300&&response.statusCode()<400)throw HttpUtil.problem(502,"UPSTREAM_REDIRECT","旧连接器返回重定向，未跟随");if(ex.getRequestURI().getPath().endsWith("/report")&&response.statusCode()==200){HttpUtil.bytes(ex,200,data,"text/markdown; charset=utf-8");return;}Object json;try{json=Json.parse(new String(data,StandardCharsets.UTF_8));}catch(IllegalArgumentException e){throw HttpUtil.problem(502,"UPSTREAM_INVALID_JSON","旧连接器响应不是有效 JSON");}HttpUtil.send(ex,response.statusCode(),json);}}
        catch(HttpTimeoutException e){throw HttpUtil.problem(504,"UPSTREAM_TIMEOUT","旧连接器查询超时");}catch(InterruptedException e){Thread.currentThread().interrupt();throw HttpUtil.problem(502,"UPSTREAM_UNAVAILABLE","旧连接器请求中断");}catch(IOException e){throw HttpUtil.problem(502,"UPSTREAM_UNAVAILABLE","旧连接器不可用；未回退演示");}
    }
}
