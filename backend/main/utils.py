from django.contrib.postgres.search import SearchVector, SearchQuery, SearchRank, SearchHeadline
from django.db.models import Q




# def q_search(query):
#     keywords = [word for word in query.split() if len(word) > 2]
#
#     q_objects = Q()
#
#     for token in keywords:
#         q_objects |= Q(name__icontains=token)
#
#     return Restaurans.objects.filter(q_objects)
