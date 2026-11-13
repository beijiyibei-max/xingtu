import com.sun.net.httpserver.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.*;
import java.util.concurrent.*;

final class Auth {
    private final byte[] token;
    private final Map<String,Long> sessions=new ConcurrentHashMap<>();
    private final Map<String,Deque<Long>> failures=new HashMap<>();
    private final boolean secure=Boolean.parseBoolean(HttpUtil.env("XT_COOKIE_SECURE","false"));
    private final String publicOrigin=HttpUtil.env("XT_PUBLIC_ORIGIN","");
    Auth(String token){this.token=token.getBytes(StandardCharsets.UTF_8);if(!publicOrigin.isEmpty()){URI uri=URI.create(publicOrigin);if(!Set.of("http","https").contains(uri.getScheme())||uri.getHost()==null||uri.getRawUserInfo()!=null||uri.getRawQuery()!=null||uri.getRawFragment()!=null||!(uri.getPath().isEmpty()||uri.getPath().equals("/")))throw new IllegalArgumentException("XT_PUBLIC_ORIGIN 应为不含路径的完整站点地址");}if(secure&&!publicOrigin.startsWith("https://"))throw new IllegalArgumentException("安全 Cookie 需要配置 HTTPS 的 XT_PUBLIC_ORIGIN");}
    boolean bearer(HttpExchange ex){String a=ex.getRequestHeaders().getFirst("Authorization");return a!=null&&MessageDigest.isEqual(("Bearer "+new String(token,StandardCharsets.UTF_8)).getBytes(StandardCharsets.UTF_8),a.getBytes(StandardCharsets.UTF_8));}
    private String cookie(HttpExchange ex){String raw=ex.getRequestHeaders().getFirst("Cookie");if(raw!=null)for(String part:raw.split(";")){String p=part.trim();if(p.startsWith("xt_session="))return p.substring(11);}return "";}
    boolean valid(HttpExchange ex){if(bearer(ex))return true;Long until=sessions.get(cookie(ex));return until!=null&&until>System.currentTimeMillis();}
    void require(HttpExchange ex){if(!valid(ex))throw HttpUtil.problem(401,"LOGIN_REQUIRED","请先登录星图");if(!Set.of("GET","HEAD").contains(ex.getRequestMethod())&&!bearer(ex))origin(ex);}
    void origin(HttpExchange ex){String actual=ex.getRequestHeaders().getFirst("Origin");if(actual==null)throw HttpUtil.problem(403,"ORIGIN_REQUIRED","浏览器写入操作需要同源验证");String host=ex.getRequestHeaders().getFirst("Host");String expected=publicOrigin.isEmpty()?"http://"+host:publicOrigin.replaceAll("/$","");if(!expected.equals(actual))throw HttpUtil.problem(403,"ORIGIN_DENIED","不接受来自其他站点的写入操作");}
    synchronized void login(HttpExchange ex)throws IOException{
        HttpUtil.method(ex,"POST");origin(ex);String ip=ex.getRemoteAddress().getAddress().getHostAddress();long now=System.currentTimeMillis();
        failures.values().forEach(q->{while(!q.isEmpty()&&q.peekFirst()<now-120000)q.removeFirst();});failures.entrySet().removeIf(e->e.getValue().isEmpty());
        Deque<Long> failed=failures.get(ip);if(failed!=null&&failed.size()>=20)throw HttpUtil.problem(429,"LOGIN_RATE_LIMIT","尝试次数过多，请两分钟后重试");
        Map<String,Object> input=HttpUtil.jsonBody(ex,2048);HttpUtil.fields(input,"token");Object value=input.get("token");
        if(!(value instanceof String)||!MessageDigest.isEqual(token,((String)value).getBytes(StandardCharsets.UTF_8))){if(failures.size()<256||failures.containsKey(ip))failures.computeIfAbsent(ip,k->new ArrayDeque<>()).add(now);HttpUtil.audit("login","denied");throw HttpUtil.problem(401,"INVALID_TOKEN","访问密钥不正确");}
        failures.remove(ip);sessions.entrySet().removeIf(e->e.getValue()<now);if(sessions.size()>=128)throw HttpUtil.problem(429,"SESSION_LIMIT","有效会话过多，请稍后再试");
        sessions.remove(cookie(ex));byte[] random=new byte[32];new SecureRandom().nextBytes(random);String id=Base64.getUrlEncoder().withoutPadding().encodeToString(random);sessions.put(id,now+8*3600000L);
        ex.getResponseHeaders().set("Set-Cookie","xt_session="+id+"; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800"+(secure?"; Secure":""));HttpUtil.audit("login","ok");HttpUtil.send(ex,200,HttpUtil.map("ok",true));
    }
    void logout(HttpExchange ex)throws IOException{HttpUtil.method(ex,"POST");require(ex);sessions.remove(cookie(ex));ex.getResponseHeaders().set("Set-Cookie","xt_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0"+(secure?"; Secure":""));HttpUtil.send(ex,200,HttpUtil.map("ok",true));}
}
