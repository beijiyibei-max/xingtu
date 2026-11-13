import com.sun.net.httpserver.*;
import java.io.*;
import java.nio.file.*;
import java.time.Instant;
import java.util.*;

final class EvidenceStore {
    private final Path data;
    EvidenceStore(Path data)throws IOException{this.data=data.resolve("snapshots");Files.createDirectories(this.data);}
    void handle(HttpExchange ex,String path)throws IOException{
        if(path.equals("/api/ingest")){
            HttpUtil.method(ex,"POST");Map<String,Object> snap=EvidenceSchema.validate(HttpUtil.jsonBody(ex,65536));String name=Instant.now().toString().replace(':','-')+"-"+UUID.randomUUID()+".json";
            synchronized(this){try(var files=Files.list(data)){if(files.filter(p->p.toString().endsWith(".json")).count()>=5000)throw HttpUtil.problem(409,"EVIDENCE_LIMIT","服务器证据已达 5000 份，请由管理员归档");}HttpUtil.atomic(data.resolve(name),snap);}
            HttpUtil.audit("evidence.ingest","ok");HttpUtil.send(ex,201,HttpUtil.map("ok",true,"id",name));return;
        }
        HttpUtil.method(ex,"GET");List<Map<String,Object>> list=new ArrayList<>();List<Path> files=new ArrayList<>();try(var stream=Files.newDirectoryStream(data,"*.json")){for(Path f:stream)files.add(f);}files.sort(Comparator.reverseOrder());
        for(Path file:files){if(Files.size(file)>65536)continue;try{Map<String,Object> snap=EvidenceSchema.validate(Json.parse(Files.readString(file)));snap.put("_id",file.getFileName().toString());list.add(snap);}catch(IllegalArgumentException e){HttpUtil.audit("evidence.read","invalid-record-skipped");}}
        if(path.equals("/api/scopes")){Map<String,Object> scopes=new LinkedHashMap<>();for(Map<String,Object> s:list){Map<String,Object> scope=HttpUtil.map("projectId",s.get("projectId"),"clusterId",s.get("clusterId"),"namespace",s.get("namespace"));scopes.put(Json.stringify(scope),scope);}HttpUtil.send(ex,200,HttpUtil.map("scopes",new ArrayList<>(scopes.values())));return;}
        Map<String,String> q=HttpUtil.query(ex);for(String key:List.of("projectId","clusterId","namespace"))if(q.getOrDefault(key,"").isBlank())throw HttpUtil.problem(400,"SCOPE_REQUIRED","必须同时指定 projectId、clusterId、namespace");
        list.removeIf(s->!s.get("projectId").equals(q.get("projectId"))||!s.get("clusterId").equals(q.get("clusterId"))||!s.get("namespace").equals(q.get("namespace")));
        if(path.equals("/api/latest")){if(list.isEmpty())throw HttpUtil.problem(404,"NO_EVIDENCE","此环境没有证据");Map<String,Object> latest=list.get(0);latest.remove("_id");HttpUtil.send(ex,200,latest);return;}
        List<Object> summaries=new ArrayList<>();for(Map<String,Object> s:list){if(summaries.size()>=100)break;summaries.add(HttpUtil.map("id",s.get("_id"),"generatedAt",s.get("generatedAt"),"count",((List<?>)s.get("capabilities")).size()));}HttpUtil.send(ex,200,HttpUtil.map("snapshots",summaries));
    }
}
