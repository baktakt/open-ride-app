"""Build checked-in indoor route assets from OSM routing and public Terrarium terrain.
Run deliberately, not at app startup. Data attribution is retained in every route.
"""
import hashlib, io, json, math, os, time, urllib.parse, urllib.request, uuid
from pathlib import Path
from PIL import Image
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'backend/routes'
CACHE = ROOT / '.cache/starter-routes'
CACHE.mkdir(parents=True, exist_ok=True)

def request(url):
    req=urllib.request.Request(url,headers={'User-Agent':'OpenRide/0.1 route-editor (https://github.com/baktakt/open-ride-app)'})
    with urllib.request.urlopen(req, timeout=90) as response: return response.read()
def cached(url):
    path=CACHE/hashlib.sha256(url.encode()).hexdigest()
    if path.exists(): return path.read_bytes()
    data=request(url);path.write_bytes(data);return data

def distance(a,b):
    rad=math.pi/180
    h=math.sin((b[1]-a[1])*rad/2)**2+math.cos(a[1]*rad)*math.cos(b[1]*rad)*math.sin((b[0]-a[0])*rad/2)**2
    return 6371*2*math.asin(math.sqrt(min(1,h)))

def elevation(lng,lat):
    z=12;n=2**z
    x=(lng+180)/360*n;y=(1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2*n
    tx,ty=int(x),int(y)
    url=f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{tx}/{ty}.png'
    image=Image.open(io.BytesIO(cached(url)))
    r,g,b=image.getpixel((min(255,int((x-tx)*256)),min(255,int((y-ty)*256))))[:3]
    return r*256+g+b/256-32768

def story(title,lat,lng,text): return {'title':title,'lat':lat,'lng':lng,'text':text}

routes=[
 dict(slug='whitechapel-1888',name='Whitechapel 1888: Beyond the Ripper Legend',theme='History & mystery',speed=24,
 description='A non-graphic East End loop about the women, the neighbourhood and the unsolved 1888 crimes. A short, reflective historical ride.',
 contentNote='Discusses historical murders without graphic detail; focuses on victims and uncertainty.',
 waypoints=[[-.0765,51.5099],[-.0723,51.5153],[-.0751,51.5192],[-.0727,51.5202],[-.0595,51.5195],[-.0609,51.5103],[-.0512,51.5061],[-.0639,51.5037],[-.0788,51.5130],[-.0765,51.5099]],
 sources=[{'title':'London Museum: Jack the Ripper','url':'https://www.londonmuseum.org.uk/collections/london-stories/jack-ripper/'}],
 stories=[
 story('Whitechapel: five lives, not a legend',51.5153,-.0723,"We are entering Whitechapel, where five women were killed in the autumn of 1888. The unknown killer became known as Jack the Ripper. This ride looks beyond the legend, remembering the people and the East End community whose lives were changed."),
 story('Spitalfields and the lives behind the headlines',51.5192,-.0751,"Around Spitalfields, consider the lives behind the newspaper headlines. The five women associated with the case were Mary Ann Nichols, Annie Chapman, Elizabeth Stride, Catherine Eddowes and Mary Jane Kelly. Remembering their names shifts the story from a mysterious killer to human lives."),
 story('Durward Street and historical uncertainty',51.5195,-.0595,"This part of Whitechapel belongs to a story that remains unresolved. The murderer was never identified, and later theories often rested on thin evidence. As the streets pass, keep that distinction in mind: a compelling explanation is not the same as a proven one."),
 story('Mitre Square: remembering Catherine Eddowes',51.5130,-.0788,"Near Mitre Square, we remember Catherine Eddowes, one of the five women linked to the 1888 murders. Modern historians have increasingly examined the women's lives and the poverty surrounding them. That wider history helps us understand the East End without turning suffering into spectacle.")]),
 dict(slug='hollywood-history',name='Hollywood: Stars, Studios & Historic Homes',theme='Film & architecture',speed=14,
 description='From a grand film-location mansion to modernist house museums, movie-palace Hollywood and the climb to Griffith Observatory.',contentNote='Public landmarks and historic visitor sites; no current private celebrity residences.',
 waypoints=[[-118.4016,34.0919],[-118.3724,34.0881],[-118.3435,34.0886],[-118.3409,34.1017],[-118.3362,34.1110],[-118.2944,34.1003],[-118.3004,34.1184]],
 sources=[{'title':'Friends of Greystone: history','url':'https://greystonemansion.org/history-2/'},{'title':'MAK Center: mission and history','url':'https://www.makcenter.org/about'},{'title':'Frank Lloyd Wright Foundation: Hollyhock House','url':'https://franklloydwright.org/site/hollyhock-house/'},{'title':'LA Conservancy: Chinese Theatre','url':'https://www.laconservancy.org/learn/historic-places/chinese-theatre/'},{'title':'Griffith Observatory history','url':'https://griffithobservatory.lacity.gov/about/observatory-history/'}],
 stories=[
 story('Greystone: a house with a screen career',34.0919,-118.4016,"We begin near Greystone Mansion in Beverly Hills, a historic estate familiar from many screen productions. This ride follows public landmarks and historic sites rather than today's private celebrity homes. Hollywood's story is also written in buildings: the places where people lived, worked and imagined different futures."),
 story('Schindler House: living as an experiment',34.0881,-118.3724,"Nearby is the Schindler House, completed in 1922 and now the home of the MAK Center. Here architecture was an experiment in how people might live and work. As we ride through West Hollywood, think of a house as a creative proposition rather than simply a monument to fame."),
 story('A movie palace on Hollywood Boulevard',34.1017,-118.3409,"The Chinese Theatre opened in 1927, during Hollywood's great age of movie palaces. Sid Grauman understood that arriving at a cinema could itself become a performance. The boulevard reminds us that film history includes audiences, architecture and the anticipation outside the screen."),
 story('Hollyhock House and a new Los Angeles',34.1003,-118.2944,"Near Barnsdall Art Park stands Hollyhock House, Frank Lloyd Wright's first Los Angeles commission, built for Aline Barnsdall between 1919 and 1921. Its terraces and forms helped imagine a different kind of Southern California home. This house museum offers a quieter chapter alongside the movie-star mythology."),
 story('Griffith Observatory: the stars above Hollywood',34.1184,-118.3004,"Our climb ends near Griffith Observatory, which opened in 1935. Here the word stars takes on another meaning. After a ride through Hollywood's constructed worlds, this public institution turns attention to the real sky, offering a fitting change of scale at the end of the road.")]),
 dict(slug='rome-appian-way',name='Rome: Empire, Baths & the Appian Way',theme='Ancient history',speed=18,
 description='Leave the Colosseum for the Circus Maximus, monumental baths and the ancient road out toward Roman tombs and villas.',contentNote='An indoor interpretation of the road network, not an outdoor navigation recommendation.',
 waypoints=[[12.4922,41.8902],[12.4851,41.8861],[12.4924,41.879],[12.502,41.873],[12.520,41.852],[12.552,41.829],[12.522,41.861],[12.4922,41.8902]],
 sources=[{'title':'Turismo Roma: baths and amphitheatres','url':'https://www.turismoroma.it/en/node/6134'},{'title':'Turismo Roma: Baths of Caracalla','url':'https://www.turismoroma.it/en/places/baths-caracalla'},{'title':'Turismo Roma: Appian Way itinerary','url':'https://www.turismoroma.it/en/itineraries/la-appia-antica'}],
 stories=[
 story('The Colosseum and the scale of empire',41.8902,12.4922,"We begin beside the Colosseum, an amphitheatre created under the Flavian emperors in the first century. Its scale expresses the public power of imperial Rome. As we leave the centre, our route follows another side of that power: roads, baths and the infrastructure that connected daily life across an empire."),
 story('Circus Maximus: a city gathered for racing',41.8861,12.4851,"Nearby lies the Circus Maximus, the great racing ground between the Palatine and Aventine hills. Chariot racing drew enormous crowds and fierce loyalties. The open space is a reminder that ancient Rome was a lived city of noise, rivalry and shared entertainment, not just a collection of ruins."),
 story('The Baths of Caracalla',41.879,12.4924,"As we pass near the Baths of Caracalla, imagine bathing as a public institution on a monumental scale. The complex opened in the early third century and combined bathing with spaces for exercise and leisure. Its surviving walls reveal how engineering shaped the everyday social world of Rome."),
 story('The Appian Way and Cecilia Metella',41.852,12.520,"We are following the corridor of the Appian Way, a road begun in 312 BC and named for Appius Claudius Caecus. Near the tomb of Cecilia Metella, the roadside itself becomes a historical document: movement, memory and status were displayed along one of Rome's great approaches."),
 story('The Villa of the Quintilii',41.829,12.552,"Near the Villa of the Quintilii, the ride reaches the landscape of elite life beyond the city centre. The villa belonged to two brothers and later became imperial property. Turning back toward Rome, notice how the ancient road connects public spectacle with private wealth and the countryside beyond.")]),
 dict(slug='paris-revolution',name='Paris: Revolution & the River',theme='Revolutionary history',speed=18,
 description='A broad Paris loop connecting the Bastille, the old royal centre, Concorde, the Arc de Triomphe and the Left Bank.',contentNote='Includes non-graphic references to revolutionary imprisonment and execution.',
 waypoints=[[2.369,48.853],[2.3625,48.8576],[2.3458,48.8559],[2.3212,48.8656],[2.295,48.8738],[2.3125,48.8566],[2.346,48.8462],[2.369,48.853]],
 sources=[{'title':'CMN: Conciergerie and Marie Antoinette','url':'https://www.paris-conciergerie.fr/en/discover/marie-antoinette-at-the-conciergerie'},{'title':'CMN: history of the Pantheon','url':'https://www.paris-pantheon.fr/en/discover/history-of-the-pantheon'},{'title':'CMN: history of the Arc de Triomphe','url':'https://www.paris-arc-de-triomphe.fr/decouvrir/histoire-de-l-arc-de-triomphe'},{'title':'City of Paris: history of the Bastille','url':'https://www.paris.fr/pages/petites-et-grandes-histoires-de-la-bastille-15995'},{'title':'City of Paris: Concorde and the Revolution','url':'https://parcoursrevolution.paris.fr/fr/quartiers/12-le-quartier-de-la-place-de-la-concorde'}],
 stories=[
 story('Bastille: a fortress remembered in a square',48.853,2.369,"We start at the Bastille, where a fortress once stood before its storming in July 1789. The square preserves a powerful name, but the July Column belongs to the revolution of 1830. Paris layers different revolutions together, and part of the pleasure of this ride is learning to separate them."),
 story('The Conciergerie: a building changes roles',48.8559,2.3458,"Near the Conciergerie, medieval royal Paris meets revolutionary history. Once part of a royal palace, the building became a prison, and Marie Antoinette was held here in 1793. The same walls can carry very different meanings as political power changes hands."),
 story('Concorde: a name chosen after upheaval',48.8656,2.3212,"We are approaching Place de la Concorde. During the Revolution it was called Place de la Révolution, and became a site of public executions. The name Concorde was adopted in 1795. A name suggesting harmony sits over a history of profound conflict: a useful pause in the city's grand scenery."),
 story('The Arc de Triomphe and the memory of power',48.8738,2.295,"Nearby stands the Arc de Triomphe, commissioned by Napoleon in 1806 and completed decades later. It takes us beyond the Revolution into the memory of empire and national sacrifice. On this stretch of the ride, the city's long avenues become a stage for how France remembers its past."),
 story('The Panthéon: who does a nation remember?',48.8462,2.346,"Near the Panthéon, the route reaches a building whose changing roles reflect France's changing politics. Conceived as a church, it became a place of national commemoration during the Revolution. As we turn back, consider the question it still poses: whose lives become part of a country's shared memory?")]),
 dict(slug='alpe-dhuez',name="Alpe d’Huez: The 21-Bend Challenge",theme='Classic climb',speed=9,
 description='A sustained road climb from Bourg-d’Oisans through La Garde and Huez toward the resort, with stories from cycling history.',contentNote='Challenging sustained ascent. This follows the D211 approach, not a certified race timing course.',profile='car',
 waypoints=[[6.0304,45.0547],[6.0487,45.0707],[6.0593,45.0830],[6.0677,45.0926]],
 sources=[{'title':'Alpe d’Huez tourism: the 21 bends','url':'https://www.alpedhuez.com/en/activities/summer-activities/bike/the-21-bends/'}],
 stories=[
 story('Bourg-d’Oisans: settle into the climb',45.0547,6.0304,"We leave Bourg-d'Oisans for one of cycling's best-known roads. The celebrated Alpe d'Huez ascent is associated with twenty-one bends and more than a thousand metres of climbing. Let the early kilometres establish a sustainable rhythm; the story here unfolds through repeated corners and steady effort."),
 story('La Garde: the road as a grandstand',45.0707,6.0487,"Near La Garde, the succession of bends becomes the defining experience of the climb. Alpe d'Huez is closely associated with the Tour de France, where the road itself becomes a vast arena. On an ordinary ride, the same corners offer smaller milestones: one bend, one stretch, one manageable task at a time."),
 story('Huez: a village beneath the sporting legend',45.0830,6.0593,"As we approach Huez, remember that the mountains have a history beyond racing. The village and the resort belong to a lived Alpine landscape, while cycling has added its own modern mythology. Stay with the rhythm that brought you here rather than chasing somebody else's famous finishing time."),
 story('The final approach: your own version of the Alpe',45.0926,6.0677,"We are nearing the resort at the end of this route's climb. The official tourism description celebrates a fourteen-kilometre ascent and roughly eleven hundred metres of climbing; exact totals depend on the start and finish used. What matters now is the sustained effort you have carried up the mountain.")])
]

def build(route):
    profile=route.get('profile','bike')
    coords=';'.join(','.join(str(c) for c in point) for point in route['waypoints'])
    url=f'https://routing.openstreetmap.de/routed-{profile}/route/v1/driving/{coords}?overview=full&geometries=geojson&continue_straight=false'
    data=json.loads(cached(url))
    if data.get('code')!='Ok':raise RuntimeError(data)
    coordinates=data['routes'][0]['geometry']['coordinates']
    # Keep true road geometry while bounding the source asset size.
    sampled=[coordinates[0]]
    for coord in coordinates[1:]:
        if distance(sampled[-1],coord)>.015:sampled.append(coord)
    if sampled[-1]!=coordinates[-1]:sampled.append(coordinates[-1])
    heights=[elevation(*coord) for coord in sampled]
    # Terrain pixels are noisy; use a distance-local moving average (~75 m).
    smooth=[sum(heights[max(0,i-2):min(len(heights),i+3)])/len(heights[max(0,i-2):min(len(heights),i+3)]) for i in range(len(heights))]
    points=[];km=0
    for i,coord in enumerate(sampled):
        if i:km+=distance(sampled[i-1],coord)
        points.append(dict(lat=coord[1],lng=coord[0],ele=round(smooth[i],1),distanceFromStart=km))
    rid=str(uuid.uuid5(uuid.NAMESPACE_URL,'https://openride.local/curated/'+route['slug']))
    # IDs use v4 formatting to share the same strict resource validation as user routes.
    rid=rid[:14]+'4'+rid[15:]
    encoded=json.dumps([[p['lat'],p['lng'],p['ele'],p['distanceFromStart']] for p in points],separators=(',',':'))
    # JS JSON.stringify renders integral floats without .0. Compute hash in Node at the final step.
    duration=max(30,min(120,round(km/route['speed']*60)))
    result=dict(version=1,id=rid,name=route['name'],description=route['description'],points=points,routeHash='',estimatedMinutes=duration,totalDistance=km,elevationGain=round(sum(max(0,points[i]['ele']-points[i-1]['ele']) for i in range(1,len(points)))),minEle=min(p['ele'] for p in points),maxEle=max(p['ele'] for p in points),publishedAt='2026-11-05T12:00:00.000Z',curated=True,theme=route['theme'],contentNote=route['contentNote'],attribution='Road geometry: © OpenStreetMap contributors (ODbL), routed with OSRM/FOSSGIS. Elevation: Mapzen/AWS Terrain Tiles.',paceNote=f"About {duration} min at {route['speed']} km/h average; indoor ride time varies with power and trainer settings.",sources=route['sources'])
    stops=[]
    for index,item in enumerate(route['stories']):
        near=min(points,key=lambda p:distance([p['lng'],p['lat']],[item['lng'],item['lat']]))
        sid=str(uuid.uuid5(uuid.NAMESPACE_URL,rid+'/'+item['title']));sid=sid[:14]+'4'+sid[15:]
        stops.append(dict(id=sid,title=item['title'],text=item['text'],distanceKm=max(0,near['distanceFromStart']-.04),lat=near['lat'],lng=near['lng'],sources=route['sources']))
    stops.sort(key=lambda s:s['distanceKm'])
    result['guide']=dict(version=1,id=rid,routeHash='',routeName=route['name'],language='en',createdAt=result['publishedAt'],writingModel='editorial',speechModel='Kokoro-82M-v1.0-ONNX',voice='af_heart',stops=stops)
    print(route['slug'],round(km,1),'km',duration,'min',result['elevationGain'],'m',len(points),'points',flush=True)
    return result

if __name__=='__main__':
    built=[]
    for route in routes:
        built.append(build(route));time.sleep(1)
    OUT.mkdir(exist_ok=True)
    (OUT/'starter-routes.json').write_text(json.dumps(built,ensure_ascii=False,separators=(',',':')))
