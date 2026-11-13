import com.sun.net.httpserver.*;
import java.io.*;
import java.nio.file.*;
import java.time.Instant;
import java.util.*;

/** Versioned topology evidence, independent of V3.1's capability-state protocol. */
final class K8sTopology {
    private final Path data;
    private static final Set<String> LABEL_KEYS=Set.of("app","app.kubernetes.io/name","app.kubernetes.io/instance","component","release","dtstack.com/component");
    K8sTopology(Path root)throws IOException{data=root.resolve("topology");Files.createDirectories(data);}
    private static String ident(Map<String,Object> o,String key,boolean optional){Object value=o.get(key);if(optional&&"".equals(value))return "";String s=HttpUtil.string(o,key,100);if(!s.matches("[a-zA-Z0-9][a-zA-Z0-9._-]*"))throw HttpUtil.problem(400,"INVALID_ID","标识格式无效："+key);return s;}
    private static void optionalText(Map<String,Object> o,String key,int max){if("".equals(o.get(key)))return;HttpUtil.string(o,key,max);}
    private static void number(Object o,int min,int max){if(!(o instanceof Number)||((Number)o).doubleValue()!=((Number)o).intValue()||((Number)o).intValue()<min||((Number)o).intValue()>max)throw HttpUtil.problem(400,"INVALID_NUMBER","数值无效");}
    private static void labels(Object input){Map<String,Object> m=HttpUtil.object(input);for(var e:m.entrySet())if(!LABEL_KEYS.contains(e.getKey())||!(e.getValue() instanceof String)||((String)e.getValue()).length()>63||!((String)e.getValue()).matches("[a-zA-Z0-9._-]*"))throw HttpUtil.problem(400,"INVALID_LABEL","仅允许预定义的拓扑标签，不接收任意配置值");}
    static Map<String,Object> validate(Object input){
        Map<String,Object> s=HttpUtil.object(input);HttpUtil.fields(s,"kind","version","projectId","clusterId","namespace","generatedAt","isDemo","collection","workloads","replicaSets","pods","services");
        if(!"xingtu-k8s-topology".equals(s.get("kind"))||!(s.get("version") instanceof Number)||((Number)s.get("version")).doubleValue()!=1.0||!Boolean.FALSE.equals(s.get("isDemo")))throw HttpUtil.problem(400,"TOPOLOGY_REQUIRED","需要非演示的 7.0 拓扑 JSON；能力矩阵数据不能代替对象快照");
        for(String key:List.of("projectId","clusterId","namespace"))ident(s,key,false);
        try{if(Instant.parse(HttpUtil.string(s,"generatedAt",40)).isBefore(Instant.parse("2000-01-01T00:00:00Z")))throw new IllegalArgumentException();}catch(Exception e){throw HttpUtil.problem(400,"INVALID_TIME","采集时间需要有效的 UTC ISO 时间");}
        Map<String,Object> collection=HttpUtil.object(s.get("collection"));HttpUtil.fields(collection,"workloads","replicaSets","pods","services","truncated");if(!(collection.get("truncated") instanceof Boolean))throw HttpUtil.problem(400,"INVALID_COLLECTION","缺少截断状态");Set<String> uids=new HashSet<>();
        for(String category:List.of("workloads","replicaSets","pods","services")){
            if(!(collection.get(category) instanceof String)||!Set.of("ok","forbidden","error").contains(collection.get(category)))throw HttpUtil.problem(400,"INVALID_COLLECTION","需要明确采集状态");
            if(!(s.get(category) instanceof List)||((List<?>)s.get(category)).size()>250)throw HttpUtil.problem(400,"TOO_MANY_OBJECTS","每类最多 250 项对象");List<?> list=(List<?>)s.get(category);if(!"ok".equals(collection.get(category))&&!list.isEmpty())throw HttpUtil.problem(400,"INVALID_COLLECTION","受限类别不应带对象");Set<String> names=new HashSet<>();
            for(Object item:list){Map<String,Object> o=HttpUtil.object(item);
                switch(category){case "workloads" -> HttpUtil.fields(o,"ns","name","uid","kind","ready","image","labels");case "replicaSets" -> HttpUtil.fields(o,"ns","name","uid","ownerUid","ownerKind");case "pods" -> HttpUtil.fields(o,"ns","name","uid","phase","ready","node","ownerUid","ownerKind","ownerName","restarts","image","imageID","reason","labels");case "services" -> HttpUtil.fields(o,"ns","name","uid","selector","selectorComplete","ports");}
                if(!ident(o,"ns",false).equals(s.get("namespace")))throw HttpUtil.problem(400,"SCOPE_MISMATCH","对象超出本次 Namespace");ident(o,"name",false);String uid=ident(o,"uid",false);if(!uids.add(uid)||!names.add(o.getOrDefault("kind","")+"/"+o.get("name")))throw HttpUtil.problem(400,"DUPLICATE_OBJECT","对象名称或 UID 重复");
                if(category.equals("workloads")){if(!(o.get("kind") instanceof String)||!Set.of("Deployment","StatefulSet","DaemonSet","Job","CronJob").contains(o.get("kind")))throw HttpUtil.problem(400,"INVALID_KIND","不支持的工作负载类别");labels(o.get("labels"));}
                if(category.equals("workloads")||category.equals("pods")){if(!HttpUtil.string(o,"ready",20).matches("(?:[0-9]{1,5}/[0-9]{1,5}|\\?)"))throw HttpUtil.problem(400,"INVALID_READY","ready 格式无效");optionalText(o,"image",300);}
                if(category.equals("pods")||category.equals("replicaSets")){ident(o,"ownerUid",true);optionalText(o,"ownerKind",30);}
                if(category.equals("pods")){if(!(o.get("phase") instanceof String)||!Set.of("Running","Pending","Succeeded","Failed","Unknown").contains(o.get("phase")))throw HttpUtil.problem(400,"INVALID_PHASE","Pod phase 无效");ident(o,"ownerName",true);ident(o,"node",true);number(o.get("restarts"),0,1000000);optionalText(o,"imageID",400);optionalText(o,"reason",100);labels(o.get("labels"));}
                if(category.equals("services")){labels(o.get("selector"));if(!(o.get("selectorComplete") instanceof Boolean)||!(o.get("ports") instanceof List)||((List<?>)o.get("ports")).size()>20)throw HttpUtil.problem(400,"INVALID_SERVICE","Service 字段无效");for(Object p:(List<?>)o.get("ports"))number(p,1,65535);}
            }
        }
        return s;
    }
    private List<Map<String,Object>> list()throws IOException{List<Path> files=new ArrayList<>();try(var stream=Files.newDirectoryStream(data,"*.json")){for(Path p:stream)files.add(p);}files.sort(Comparator.reverseOrder());List<Map<String,Object>> rows=new ArrayList<>();for(Path p:files){if(Files.size(p)>65536)continue;try{Map<String,Object> s=validate(Json.parse(Files.readString(p)));s.put("_id",p.getFileName().toString());rows.add(s);}catch(IllegalArgumentException|HttpUtil.Problem e){HttpUtil.audit("topology.read","invalid-record-skipped");}}return rows;}
    synchronized void handle(HttpExchange ex,String path)throws IOException{
        if(path.equals("/api/k8s/ingest")){HttpUtil.method(ex,"POST");Map<String,Object> s=validate(HttpUtil.jsonBody(ex,65536));try(var stream=Files.list(data)){if(stream.filter(p->p.toString().endsWith(".json")).count()>=1000)throw HttpUtil.problem(409,"TOPOLOGY_LIMIT","拓扑快照已达 1000 份，请由管理员归档");}String id=Instant.now().toString().replace(':','-')+"-"+UUID.randomUUID()+".json";HttpUtil.atomic(data.resolve(id),s);HttpUtil.audit("topology.ingest","ok");HttpUtil.send(ex,201,HttpUtil.map("ok",true,"id",id));return;}
        HttpUtil.method(ex,"GET");if(!Set.of("/api/k8s/scopes","/api/k8s/latest").contains(path))throw HttpUtil.problem(404,"NOT_FOUND","没有此拓扑接口");List<Map<String,Object>> rows=list();
        if(path.equals("/api/k8s/scopes")){Map<String,Object> scopes=new LinkedHashMap<>();for(var s:rows){String key=Json.stringify(List.of(s.get("projectId"),s.get("clusterId"),s.get("namespace")));scopes.putIfAbsent(key,HttpUtil.map("projectId",s.get("projectId"),"clusterId",s.get("clusterId"),"namespace",s.get("namespace"),"generatedAt",s.get("generatedAt")));}HttpUtil.send(ex,200,HttpUtil.map("scopes",new ArrayList<>(scopes.values())));return;}
        Map<String,String> q=HttpUtil.query(ex);for(String key:List.of("projectId","clusterId","namespace"))if(q.getOrDefault(key,"").isBlank())throw HttpUtil.problem(400,"SCOPE_REQUIRED","必须选择项目、集群与 Namespace");
        for(var s:rows)if(s.get("projectId").equals(q.get("projectId"))&&s.get("clusterId").equals(q.get("clusterId"))&&s.get("namespace").equals(q.get("namespace"))){s.remove("_id");HttpUtil.send(ex,200,s);return;}throw HttpUtil.problem(404,"NO_TOPOLOGY","此环境还没有拓扑快照；可先使用 7.0 知识图，或在授权后导入拓扑 JSON");
    }
}
