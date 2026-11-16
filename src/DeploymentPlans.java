import com.sun.net.httpserver.HttpExchange;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.Instant;
import java.util.*;
import java.util.regex.*;

/** Personal deployment drafts. No remote connections, execution or inferred approval. */
final class DeploymentPlans {
    private final Path directory;
    private final String catalogHash;
    private final List<Map<String,Object>> catalog=new ArrayList<>();
    private static final Pattern PARAM=Pattern.compile("\\{\\{([A-Za-z]+)\\}\\}");
    private static final Set<String> PARAMS=Set.of("ns","emNs","objectNs","pod","node","container","service","claim","job","workload","archive","path","host","port");
    DeploymentPlans(Path data)throws IOException{
        directory=data.resolve("deployment-plans");Files.createDirectories(directory);
        byte[] bytes=HttpUtil.resource("/fixtures/deployment-plan.json");
        try{catalogHash=HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(bytes));}
        catch(java.security.NoSuchAlgorithmException e){throw new IOException(e);}
        for(Object step:(List<?>)Json.parse(new String(bytes,StandardCharsets.UTF_8)))catalog.add(HttpUtil.object(step));
    }
    private Path file(String id){
        if(!id.matches("[a-f0-9-]{36}"))throw HttpUtil.problem(400,"PLAN_ID_INVALID","操作单编号无效");
        return directory.resolve(id+".json");
    }
    private Map<String,Object> load(String id)throws IOException{
        Path path=file(id);if(!Files.isRegularFile(path))throw HttpUtil.problem(404,"PLAN_NOT_FOUND","操作单不存在");
        return HttpUtil.object(Json.parse(Files.readString(path)));
    }
    private static long revision(Map<String,Object> data){return ((Number)data.get("revision")).longValue();}
    private static boolean resolved(Object status){return Set.of("recorded","not-applicable").contains(String.valueOf(status));}
    private void save(Map<String,Object> plan)throws IOException{
        Path path=file((String)plan.get("id")),temp=Files.createTempFile(directory,"save-",".tmp");
        try{Files.writeString(temp,Json.stringify(plan),StandardCharsets.UTF_8);
            try{Files.move(temp,path,StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);}
            catch(AtomicMoveNotSupportedException e){Files.move(temp,path,StandardCopyOption.REPLACE_EXISTING);}
        }finally{Files.deleteIfExists(temp);}
    }
    private static String value(Map<String,Object> map,String key,String pattern,int max){
        String v=HttpUtil.string(map,key,max);if(!v.matches(pattern))throw HttpUtil.problem(400,"PARAMETER_INVALID","请核对字段："+key);return v;
    }
    private static String choice(Map<String,Object> map,String key,String... allowed){
        String v=HttpUtil.string(map,key,40);if(!Set.of(allowed).contains(v))throw HttpUtil.problem(400,"PARAMETER_INVALID","请核对选项："+key);return v;
    }
    private static Map<String,Object> scope(Object input){
        Map<String,Object> v=HttpUtil.object(input);HttpUtil.fields(v,"alias","cluster","manager","network","storage","ns","emNs");
        value(v,"alias","[\\p{L}\\p{N}][\\p{L}\\p{N}._-]{0,39}",40);
        choice(v,"cluster","new","reuse");choice(v,"manager","new","reuse");
        choice(v,"network","offline","approved-network");choice(v,"storage","s3","nfs","mixed");
        for(String key:List.of("ns","emNs"))value(v,key,"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?",63);
        if(v.get("cluster").equals("new")&&v.get("manager").equals("reuse"))throw HttpUtil.problem(400,"ROUTE_CONFLICT","复用 EM 前需确认已有集群路线");
        return v;
    }
    private static Map<String,Object> bindings(Object input){
        Map<String,Object> v=HttpUtil.object(input);
        for(String key:v.keySet()){
            if(!PARAMS.contains(key)||Set.of("ns","emNs").contains(key))throw HttpUtil.problem(400,"PARAMETER_INVALID","未知或由项目统一设置的参数："+key);
            String s=HttpUtil.string(v,key,256);
            String pattern=switch(key){
                case "archive" -> "[a-zA-Z0-9_./][a-zA-Z0-9_./-]{0,255}";
                case "path" -> "/[a-zA-Z0-9_./-]{0,255}";
                case "host" -> "[a-zA-Z0-9][a-zA-Z0-9.:-]{0,252}";
                case "port" -> "[0-9]{1,5}";
                default -> "[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?";
            };
            if(!s.matches(pattern)||(key.equals("port")&&(Integer.parseInt(s)<1||Integer.parseInt(s)>65535)))throw HttpUtil.problem(400,"PARAMETER_INVALID","参数格式无效："+key);
            if(Set.of("archive","path").contains(key)&&Arrays.asList(s.split("/")).contains(".."))throw HttpUtil.problem(400,"PARAMETER_INVALID","路径不能包含上级目录跳转");
        }
        return v;
    }
    private Map<String,Object> generate(Map<String,Object> body)throws IOException{
        HttpUtil.fields(body,"scope","target","context","confirmed","allowAssistant","id","revision");
        var project=scope(body.get("scope"));
        String target=value(body,"target","[\\p{L}\\p{N}][\\p{L}\\p{N}._:-]{0,79}",80);
        String context="";
        if(!(body.get("context") instanceof String))throw HttpUtil.problem(400,"PARAMETER_INVALID","context 必须为文本，尚未安装时可留空");
        if(!body.get("context").equals(""))context=value(body,"context","[a-zA-Z0-9][a-zA-Z0-9._:/@-]{0,252}",253);
        if(!(body.get("confirmed") instanceof Boolean)||!(body.get("allowAssistant") instanceof Boolean))throw HttpUtil.problem(400,"CONFIRMATION_REQUIRED","请选择现场值确认和助手使用许可");
        long next=1;String id=UUID.randomUUID().toString();
        if(body.containsKey("id")){id=HttpUtil.string(body,"id",36);var old=load(id);checkRevision(old,body);next=revision(old)+1;}
        else try(var files=Files.list(directory)){if(files.filter(p->p.toString().endsWith(".json")).count()>=100)throw HttpUtil.problem(409,"PLAN_LIMIT","已达到 100 份操作单上限，请先整理项目");}
        var result=HttpUtil.map("kind","xingtu-deployment-draft","id",id,"revision",next,
            "scope",project,"target",target,"context",context,"confirmed",body.get("confirmed"),"allowAssistant",body.get("allowAssistant"),"catalogHash",catalogHash,
            "updatedAt",Instant.now().toString(),"records",new LinkedHashMap<String,Object>());
        save(result);HttpUtil.audit("deployment-plan","generated");return view(result);
    }
    private static void checkRevision(Map<String,Object> plan,Map<String,Object> body){
        if(!(body.get("revision") instanceof Number n)||n.doubleValue()!=revision(plan))throw HttpUtil.problem(409,"PLAN_REVISION_CHANGED","操作单已更新，请刷新后重试；旧页面不能继续放行");
    }
    private Map<String,Object> step(String id){return catalog.stream().filter(s->id.equals(s.get("id"))).findFirst().orElseThrow(()->HttpUtil.problem(404,"STEP_NOT_FOUND","没有此部署步骤"));}
    private Map<String,Object> view(Map<String,Object> plan){
        var result=new LinkedHashMap<>(plan);var steps=new ArrayList<>();var records=HttpUtil.object(plan.get("records"));
        boolean templateChanged=!catalogHash.equals(plan.get("catalogHash"));
        String first="";
        for(var step:catalog){
            var record=HttpUtil.object(records.getOrDefault(step.get("id"),HttpUtil.map("status","pending")));
            if(templateChanged){record=new LinkedHashMap<>(record);record.put("status","stale");}
            if(first.isEmpty()&&!resolved(record.get("status")))first=(String)step.get("id");
            steps.add(HttpUtil.map("id",step.get("id"),"title",step.get("title"),"checks",step.get("checks"),
                "sources",step.get("sources"),"optional",Boolean.TRUE.equals(step.get("optional")),"record",record));
        }
        result.put("steps",steps);result.put("nextStepId",first);result.put("executionApproved",false);result.put("templateChanged",templateChanged);
        result.put("notice",templateChanged?"教学模板已更新，旧记录仅供回看。请重新生成操作单后核验，旧版不能继续复制命令或保存核对结果。":"这是绑定项目值的部署草稿；人工核对记录不等于 V2.1 证据验收或现场变更批准。");return result;
    }
    private Map<String,Object> card(Map<String,Object> plan,Map<String,Object> step,int index,Map<String,Object> inputs){
        var tutorial=(List<?>)step.get("tutorial");if(index<0||index>=tutorial.size())throw HttpUtil.problem(400,"CARD_INVALID","教学卡编号无效");
        var card=HttpUtil.object(tutorial.get(index));var project=HttpUtil.object(plan.get("scope"));
        var values=new LinkedHashMap<>(inputs);values.put("ns",project.get("ns"));values.put("emNs",project.get("emNs"));
        String template=String.valueOf(card.get("text"));var missing=new LinkedHashSet<String>();Matcher matcher=PARAM.matcher(template);StringBuffer rendered=new StringBuffer();
        while(matcher.find()){String key=matcher.group(1);if(!PARAMS.contains(key))throw HttpUtil.problem(409,"TEMPLATE_INVALID","模板参数需要维护");Object v=values.get(key);if(v==null)missing.add(key);matcher.appendReplacement(rendered,Matcher.quoteReplacement(v==null?"‹"+key+"待填写›":v.toString()));}matcher.appendTail(rendered);
        String text=rendered.toString();
        boolean needsContext="terminal".equals(card.get("kind"))&&Pattern.compile("\\bkubectl\\s+").matcher(text).find();
        boolean contextMissing=String.valueOf(plan.get("context")).isBlank();
        if(needsContext&&!contextMissing)text=text.replaceAll("\\bkubectl\\s+",Matcher.quoteReplacement("kubectl --context '"+plan.get("context")+"' "));
        boolean change=Boolean.TRUE.equals(card.get("change"));
        boolean reuse=("newCluster".equals(card.get("mode"))&&"reuse".equals(project.get("cluster")))||("newManager".equals(card.get("mode"))&&"reuse".equals(project.get("manager")));
        String reason=reuse?"当前路线复用已有环境，这张安装卡不放行":change?"变更命令需要 V2.1 正式操作单、目标核验及现场批准":!Boolean.TRUE.equals(plan.get("confirmed"))?"项目值尚未确认":needsContext&&contextMissing?"集群 context 尚未登记；先完成主机准备，集群建立后更新操作单":!missing.isEmpty()?"先补齐本条命令参数":"";
        var result=new LinkedHashMap<>(card);result.put("index",index);result.put("missing",new ArrayList<>(missing));result.put("blockedReason",reason);
        result.put("copyAllowed",reason.isEmpty()&&"terminal".equals(card.get("kind")));result.put("text",change||reuse?"请按正式操作单核对该项变更。":text);return result;
    }
    synchronized Map<String,Object> assistantProject(String id)throws IOException{return load(id);}
    synchronized void handle(HttpExchange ex,String path)throws Exception{
        if(path.equals("/api/deployment/plans")&&ex.getRequestMethod().equals("GET")){
            var list=new ArrayList<>();try(var files=Files.list(directory)){for(Path file:files.filter(p->p.toString().endsWith(".json")).sorted().toList()){var p=HttpUtil.object(Json.parse(Files.readString(file)));list.add(HttpUtil.map("id",p.get("id"),"alias",HttpUtil.object(p.get("scope")).get("alias"),"revision",p.get("revision"),"updatedAt",p.get("updatedAt")));}}
            HttpUtil.send(ex,200,HttpUtil.map("plans",list));return;
        }
        HttpUtil.method(ex,"POST");var body=HttpUtil.jsonBody(ex,32768);
        if(path.equals("/api/deployment/plans/generate")){HttpUtil.send(ex,200,generate(body));return;}
        HttpUtil.fields(body,"id","revision","stepId","cardIndex","inputs","status","checks","reference");
        var plan=load(HttpUtil.string(body,"id",36));
        if(path.equals("/api/deployment/plans/open")){HttpUtil.send(ex,200,view(plan));return;}
        if(!catalogHash.equals(plan.get("catalogHash")))throw HttpUtil.problem(409,"PLAN_TEMPLATE_CHANGED","教学模板已更新，请重新生成操作单；旧记录不能继承");
        checkRevision(plan,body);var step=step(HttpUtil.string(body,"stepId",80));
        if(path.equals("/api/deployment/plans/cards")){
            var cards=new ArrayList<>();for(int i=0;i<((List<?>)step.get("tutorial")).size();i++)cards.add(card(plan,step,i,Map.of()));
            HttpUtil.send(ex,200,HttpUtil.map("cards",cards,"revision",revision(plan)));return;
        }
        if(path.equals("/api/deployment/plans/command")){
            if(!(body.get("cardIndex") instanceof Number n)||n.doubleValue()!=n.intValue())throw HttpUtil.problem(400,"CARD_INVALID","请选择教学卡");
            var command=card(plan,step,n.intValue(),bindings(body.get("inputs")));
            if(!Boolean.TRUE.equals(command.get("copyAllowed")))throw HttpUtil.problem(409,"COMMAND_BLOCKED",String.valueOf(command.get("blockedReason")));
            HttpUtil.send(ex,200,HttpUtil.map("command",command.get("text"),"target",plan.get("target"),"revision",revision(plan),"executionApproved",false));return;
        }
        if(path.equals("/api/deployment/plans/record")){
            String status=choice(body,"status","recorded","blocked","not-applicable");
            if(status.equals("not-applicable")&&!Boolean.TRUE.equals(step.get("optional")))throw HttpUtil.problem(409,"STEP_REQUIRED","必需步骤不能标记为范围外");
            String reference=value(body,"reference","[\\p{L}\\p{N}_.-]{1,80}",80);
            var checks=body.get("checks");if(!(checks instanceof List<?> selected))throw HttpUtil.problem(400,"CHECKS_REQUIRED","请逐项核对反馈");
            int count=((List<?>)step.get("checks")).size();var seen=new HashSet<Integer>();
            for(Object item:selected){if(!(item instanceof Number n)||n.doubleValue()!=n.intValue()||n.intValue()<0||n.intValue()>=count||!seen.add(n.intValue()))throw HttpUtil.problem(400,"CHECKS_INVALID","核对项无效");}
            if(status.equals("recorded")&&seen.size()!=count)throw HttpUtil.problem(409,"CHECKS_INCOMPLETE","仍有未核对的验收项");
            var records=HttpUtil.object(plan.get("records"));
            if(status.equals("recorded"))for(var previous:catalog){if(previous==step)break;if(!resolved(HttpUtil.object(records.getOrDefault(previous.get("id"),Map.of())).get("status")))throw HttpUtil.problem(409,"PREREQUISITE_NOT_RECORDED","请先核对前面的步骤");}
            if(status.equals("blocked")){boolean after=false;for(var item:catalog){if(after)records.remove(item.get("id"));if(item==step)after=true;}}
            records.put((String)step.get("id"),HttpUtil.map("status",status,"checks",new ArrayList<>(seen),"reference",reference,"updatedAt",Instant.now().toString()));
            plan.put("revision",revision(plan)+1);plan.put("updatedAt",Instant.now().toString());save(plan);HttpUtil.audit("deployment-plan","recorded");HttpUtil.send(ex,200,view(plan));return;
        }
        throw HttpUtil.problem(404,"NOT_FOUND","没有此操作单接口");
    }
}
