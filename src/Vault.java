import com.sun.net.httpserver.*;
import java.io.*;
import java.nio.file.*;
import java.time.Instant;
import java.util.*;

/** Stores only browser-encrypted archives; the server never receives the archive password. */
final class Vault {
    private final Path data;
    Vault(Path data)throws IOException{this.data=data.resolve("projects");Files.createDirectories(this.data);}
    private String id(String id){try{if(!UUID.fromString(id).toString().equals(id))throw new IllegalArgumentException();return id;}catch(Exception e){throw HttpUtil.problem(400,"INVALID_ID","项目备份编号无效");}}
    private List<Path> versions(String id)throws IOException{Path dir=data.resolve(id(id));List<Path> files=new ArrayList<>();if(Files.isDirectory(dir))try(DirectoryStream<Path> stream=Files.newDirectoryStream(dir,"*.json")){for(Path p:stream)if(p.getFileName().toString().matches("[0-9]{6}\\.json"))files.add(p);}files.sort(Comparator.reverseOrder());return files;}
    private Map<String,Object> load(Path path)throws IOException{return HttpUtil.object(Json.parse(Files.readString(path)));}
    private Map<String,Object> summary(Map<String,Object> record){return HttpUtil.map("id",record.get("id"),"revision",record.get("revision"),"savedAt",record.get("savedAt"));}
    static void envelope(Object input){Map<String,Object> e=HttpUtil.object(input);HttpUtil.fields(e,"kind","version","kdf","iterations","salt","iv","ciphertext");
        if(!"xingtu-encrypted-project".equals(e.get("kind"))||!"PBKDF2-SHA256".equals(e.get("kdf"))||!number(e.get("version"),1)||!number(e.get("iterations"),210000))throw HttpUtil.problem(400,"ENCRYPTION_REQUIRED","只接收星图标准加密项目文件");
        try{for(String key:List.of("salt","iv","ciphertext")){String s=HttpUtil.string(e,key,1000000);byte[] bytes=Base64.getDecoder().decode(s);if(!Base64.getEncoder().encodeToString(bytes).equals(s))throw new IllegalArgumentException();if(key.equals("salt")&&bytes.length!=16||key.equals("iv")&&bytes.length!=12||key.equals("ciphertext")&&(bytes.length<16||bytes.length>524304))throw new IllegalArgumentException();}}catch(IllegalArgumentException ex){throw HttpUtil.problem(400,"INVALID_ENVELOPE","加密文件字段或长度不符合要求");}
    }
    private static boolean number(Object o,int n){return o instanceof Number&&((Number)o).doubleValue()==n;}
    synchronized void handle(HttpExchange ex,String suffix)throws IOException{
        if(suffix.isEmpty()){
            if(ex.getRequestMethod().equals("GET")){List<Object> list=new ArrayList<>();try(DirectoryStream<Path> stream=Files.newDirectoryStream(data)){for(Path dir:stream){if(!dir.getFileName().toString().matches("[a-f0-9-]{36}"))continue;List<Path> versions=versions(dir.getFileName().toString());if(!versions.isEmpty())list.add(summary(load(versions.get(0))));}}
                list.sort((a,b)->((String)HttpUtil.object(b).get("savedAt")).compareTo((String)HttpUtil.object(a).get("savedAt")));HttpUtil.send(ex,200,HttpUtil.map("projects",list));return;}
            HttpUtil.method(ex,"POST");Map<String,Object> input=HttpUtil.jsonBody(ex,750000);HttpUtil.fields(input,"id","baseRevision","envelope");String id=id(HttpUtil.string(input,"id",36));
            Object base=input.get("baseRevision");if(!(base instanceof Number)||((Number)base).doubleValue()!=((Number)base).intValue()||((Number)base).intValue()<0)throw HttpUtil.problem(400,"INVALID_REVISION","需要有效的起始版本号");
            envelope(input.get("envelope"));List<Path> current=versions(id);int rev=current.isEmpty()?0:((Number)load(current.get(0)).get("revision")).intValue();
            if(((Number)base).intValue()!=rev)throw HttpUtil.problem(409,"VERSION_CONFLICT","服务器已有其他更新；本次内容未覆盖，请先另存本机文件，再载入服务器版本核对");
            if(rev>=100)throw HttpUtil.problem(409,"VERSION_LIMIT","此备份已达 100 个版本，请新建备份归档");
            if(rev==0){try(var stream=Files.list(data)){if(stream.filter(Files::isDirectory).count()>=200)throw HttpUtil.problem(409,"PROJECT_LIMIT","服务器备份已达 200 份，请由管理员归档");}}
            Files.createDirectories(data.resolve(id));Map<String,Object> saved=HttpUtil.map("id",id,"revision",rev+1,"savedAt",Instant.now().toString(),"envelope",input.get("envelope"));HttpUtil.atomic(data.resolve(id).resolve(String.format(Locale.ROOT,"%06d.json",rev+1)),saved);HttpUtil.audit("project.backup","ok");HttpUtil.send(ex,201,summary(saved));return;
        }
        HttpUtil.method(ex,"GET");String[] parts=suffix.split("/",-1);if(parts.length!=1&&!(parts.length==2&&parts[1].equals("versions")))throw HttpUtil.problem(404,"NOT_FOUND","不存在此备份接口");List<Path> files=versions(parts[0]);if(files.isEmpty())throw HttpUtil.problem(404,"NOT_FOUND","找不到该项目备份");
        if(parts.length==2){List<Object> list=new ArrayList<>();for(Path p:files)list.add(summary(load(p)));HttpUtil.send(ex,200,HttpUtil.map("versions",list));return;}
        String requested=HttpUtil.query(ex).get("revision");Path chosen=files.get(0);if(requested!=null){if(!requested.matches("[1-9][0-9]{0,2}"))throw HttpUtil.problem(400,"INVALID_REVISION","版本号无效");chosen=data.resolve(id(parts[0])).resolve(String.format(Locale.ROOT,"%06d.json",Integer.parseInt(requested)));if(!files.contains(chosen))throw HttpUtil.problem(404,"NOT_FOUND","找不到此历史版本");}
        HttpUtil.send(ex,200,load(chosen));
    }
}
