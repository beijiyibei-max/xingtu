import com.sun.net.httpserver.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

final class HttpUtil {
    static final class Problem extends RuntimeException {
        final int code; final String key;
        Problem(int code,String key,String message){super(message);this.code=code;this.key=key;}
    }
    static Problem problem(int code,String key,String message){return new Problem(code,key,message);}
    static Map<String,Object> map(Object... fields){Map<String,Object> m=new LinkedHashMap<>();for(int i=0;i<fields.length;i+=2)m.put((String)fields[i],fields[i+1]);return m;}
    @SuppressWarnings("unchecked") static Map<String,Object> object(Object o){if(!(o instanceof Map))throw problem(400,"INVALID_JSON","需要 JSON 对象");return (Map<String,Object>)o;}
    static String string(Map<String,Object> m,String k,int max){Object v=m.get(k);if(!(v instanceof String s)||s.length()>max||s.isBlank()||s.chars().anyMatch(c->c<32))throw problem(400,"INVALID_FIELD","字段无效："+k);return (String)v;}
    static void fields(Map<String,Object> m,String... names){Set<String> allowed=Set.of(names);for(String name:m.keySet())if(!allowed.contains(name))throw problem(400,"INVALID_FIELD","不允许的字段："+name);}
    static byte[] body(HttpExchange ex,int limit)throws IOException{
        try(InputStream in=ex.getRequestBody();ByteArrayOutputStream out=new ByteArrayOutputStream()){
            byte[] buf=new byte[8192];int n;while((n=in.read(buf))!=-1){if(out.size()+n>limit)throw problem(413,"TOO_LARGE","输入超过本接口大小限制");out.write(buf,0,n);}return out.toByteArray();
        }
    }
    static Map<String,Object> jsonBody(HttpExchange ex,int limit)throws IOException{
        String type=ex.getRequestHeaders().getFirst("Content-Type");
        if(type==null||!type.toLowerCase(Locale.ROOT).startsWith("application/json"))throw problem(415,"JSON_REQUIRED","请使用 application/json");
        return object(Json.parse(new String(body(ex,limit),StandardCharsets.UTF_8)));
    }
    static Map<String,String> query(HttpExchange ex){Map<String,String> q=new HashMap<>();String raw=ex.getRequestURI().getRawQuery();if(raw!=null)for(String part:raw.split("&")){String[] p=part.split("=",2);String k=URLDecoder.decode(p[0],StandardCharsets.UTF_8);if(q.containsKey(k))throw problem(400,"DUPLICATE_QUERY","参数重复");q.put(k,p.length==2?URLDecoder.decode(p[1],StandardCharsets.UTF_8):"");}return q;}
    static void method(HttpExchange ex,String method){if(!ex.getRequestMethod().equals(method)){ex.getResponseHeaders().set("Allow",method);throw problem(405,"METHOD_NOT_ALLOWED","该接口需要 "+method);}}
    static void send(HttpExchange ex,int code,Object value)throws IOException{bytes(ex,code,Json.stringify(value).getBytes(StandardCharsets.UTF_8),"application/json; charset=utf-8");}
    static void bytes(HttpExchange ex,int code,byte[] data,String type)throws IOException{
        Headers h=ex.getResponseHeaders();h.set("Content-Type",type);h.set("Cache-Control","no-store");h.set("X-Content-Type-Options","nosniff");h.set("X-Frame-Options","DENY");h.set("Referrer-Policy","no-referrer");
        ex.sendResponseHeaders(code,data.length);try(OutputStream out=ex.getResponseBody()){out.write(data);}
    }
    static byte[] resource(String path)throws IOException{try(InputStream in=HttpUtil.class.getResourceAsStream(path)){if(in==null)throw new FileNotFoundException(path);return in.readAllBytes();}}
    static String env(String key,String fallback){String value=System.getenv(key);return value==null||value.isBlank()?fallback:value;}
    static void atomic(Path path,Object data)throws IOException{
        Path temp=Files.createTempFile(path.getParent(),"pending-",".tmp");try{Files.writeString(temp,Json.stringify(data),StandardCharsets.UTF_8);try{Files.move(temp,path,StandardCopyOption.ATOMIC_MOVE);}catch(AtomicMoveNotSupportedException e){Files.move(temp,path);}}finally{Files.deleteIfExists(temp);}
    }
    static void audit(String action,String result){System.out.println(Json.stringify(map("at",java.time.Instant.now().toString(),"action",action,"result",result)));}
}
